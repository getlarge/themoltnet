package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
)

const contextStoreVersion = 1

type contextBinding struct {
	TeamID  string `json:"teamId"`
	DiaryID string `json:"diaryId"`
}

type contextStore struct {
	Version      int                       `json:"version"`
	Default      *contextBinding           `json:"default,omitempty"`
	Repositories map[string]contextBinding `json:"repositories,omitempty"`
	Directories  map[string]contextBinding `json:"directories,omitempty"`
}

type resolvedActivationBinding struct {
	Key       string
	Source    string
	Directory string
	Binding   *contextBinding
}

func contextStorePath(agentDir string) string {
	return filepath.Join(agentDir, "contexts.json")
}

func readContextStore(agentDir string) (*contextStore, error) {
	data, err := os.ReadFile(contextStorePath(agentDir))
	if errors.Is(err, os.ErrNotExist) {
		return &contextStore{Version: contextStoreVersion}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read context store: %w", err)
	}
	var store contextStore
	if err := json.Unmarshal(data, &store); err != nil {
		return nil, fmt.Errorf("parse context store: %w", err)
	}
	if store.Version != contextStoreVersion {
		return nil, fmt.Errorf("unsupported contexts.json version %d", store.Version)
	}
	return &store, nil
}

func writeContextStore(agentDir string, store *contextStore) error {
	store.Version = contextStoreVersion
	if len(store.Repositories) == 0 {
		store.Repositories = nil
	}
	if len(store.Directories) == 0 {
		store.Directories = nil
	}
	data, err := json.MarshalIndent(store, "", "  ")
	if err != nil {
		return err
	}
	if err := writeFileAtomic(contextStorePath(agentDir), append(data, '\n')); err != nil {
		return fmt.Errorf("write context store: %w", err)
	}
	return nil
}

func normalizeGitRemoteKey(raw string) (string, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return "", fmt.Errorf("Git remote is empty")
	}
	if !strings.Contains(value, "://") {
		if at := strings.LastIndex(value, "@"); at >= 0 {
			value = value[at+1:]
		}
		if host, repositoryPath, found := strings.Cut(value, ":"); found {
			value = "ssh://" + host + "/" + repositoryPath
		}
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Host == "" {
		return "", fmt.Errorf("cannot parse Git remote %q", raw)
	}
	host := strings.ToLower(parsed.Hostname())
	repositoryPath := strings.Trim(strings.TrimSuffix(parsed.EscapedPath(), ".git"), "/")
	decoded, err := url.PathUnescape(repositoryPath)
	if err != nil {
		return "", fmt.Errorf("decode Git remote path: %w", err)
	}
	validPath := decoded != ""
	for _, segment := range strings.Split(decoded, "/") {
		if segment == "" || segment == "." || segment == ".." {
			validPath = false
			break
		}
	}
	if host == "" || !validPath {
		return "", fmt.Errorf("Git remote %q has no canonical host/repository path", raw)
	}
	return "git:" + host + "/" + decoded, nil
}

var contextWorkingDirectory = os.Getwd

func canonicalDirectory(value string) (string, error) {
	if strings.TrimSpace(value) == "" {
		cwd, err := contextWorkingDirectory()
		if err != nil {
			return "", err
		}
		value = cwd
	}
	absolute, err := filepath.Abs(value)
	if err != nil {
		return "", err
	}
	if resolved, err := filepath.EvalSymlinks(absolute); err == nil {
		absolute = resolved
	}
	return filepath.Clean(absolute), nil
}

func gitRemoteKeyAt(directory string) (string, bool) {
	command := exec.Command("git", "-C", directory, "remote", "get-url", "--push", "origin")
	command.Stderr = nil
	output, err := command.Output()
	if err != nil || strings.TrimSpace(string(output)) == "" {
		command = exec.Command("git", "-C", directory, "remote", "get-url", "origin")
		command.Stderr = nil
		output, err = command.Output()
	}
	if err != nil {
		return "", false
	}
	key, err := normalizeGitRemoteKey(string(output))
	return key, err == nil
}

func nearestDirectoryBinding(directory string, bindings map[string]contextBinding) (string, contextBinding, bool) {
	for current := directory; ; current = filepath.Dir(current) {
		if binding, ok := bindings[current]; ok {
			return current, binding, true
		}
		parent := filepath.Dir(current)
		if parent == current {
			break
		}
	}
	return "", contextBinding{}, false
}

func resolveContextBinding(agentDir, directory string) (resolvedActivationBinding, error) {
	canonical, err := canonicalDirectory(directory)
	if err != nil {
		return resolvedActivationBinding{}, err
	}
	store, err := readContextStore(agentDir)
	if err != nil {
		return resolvedActivationBinding{}, err
	}
	if boundDirectory, binding, ok := nearestDirectoryBinding(canonical, store.Directories); ok {
		copy := binding
		return resolvedActivationBinding{Key: "dir:" + boundDirectory, Source: "directory", Directory: boundDirectory, Binding: &copy}, nil
	}
	if key, ok := gitRemoteKeyAt(canonical); ok {
		if binding, found := store.Repositories[key]; found {
			copy := binding
			return resolvedActivationBinding{Key: key, Source: "repository", Binding: &copy}, nil
		}
		if store.Default != nil {
			copy := *store.Default
			return resolvedActivationBinding{Key: key, Source: "default", Binding: &copy}, nil
		}
		return resolvedActivationBinding{Key: key}, nil
	}
	key := "dir:" + canonical
	if store.Default != nil {
		copy := *store.Default
		return resolvedActivationBinding{Key: key, Source: "default", Binding: &copy}, nil
	}
	return resolvedActivationBinding{Key: key}, nil
}

func activationCachePathForContext(agentDir, contextKey string) string {
	digest := sha256.Sum256([]byte(contextKey))
	return filepath.Join(agentDir, "activation-caches", hex.EncodeToString(digest[:])+".json")
}

func validateContextBinding(binding contextBinding) error {
	if strings.TrimSpace(binding.TeamID) == "" || strings.TrimSpace(binding.DiaryID) == "" {
		return fmt.Errorf("both --team-id and --diary-id are required")
	}
	return nil
}

func setContextBinding(agentDir, directory string, binding contextBinding, makeDefault bool, directoryOverride string) (resolvedActivationBinding, error) {
	if err := validateContextBinding(binding); err != nil {
		return resolvedActivationBinding{}, err
	}
	store, err := readContextStore(agentDir)
	if err != nil {
		return resolvedActivationBinding{}, err
	}
	if makeDefault {
		copy := binding
		store.Default = &copy
		if err := writeContextStore(agentDir, store); err != nil {
			return resolvedActivationBinding{}, err
		}
		return resolvedActivationBinding{Key: "default", Source: "default", Binding: &copy}, nil
	}
	if directoryOverride != "" {
		canonical, err := canonicalDirectory(directoryOverride)
		if err != nil {
			return resolvedActivationBinding{}, err
		}
		if store.Directories == nil {
			store.Directories = map[string]contextBinding{}
		}
		store.Directories[canonical] = binding
		if err := writeContextStore(agentDir, store); err != nil {
			return resolvedActivationBinding{}, err
		}
		copy := binding
		return resolvedActivationBinding{Key: "dir:" + canonical, Source: "directory", Directory: canonical, Binding: &copy}, nil
	}
	canonical, err := canonicalDirectory(directory)
	if err != nil {
		return resolvedActivationBinding{}, err
	}
	if key, ok := gitRemoteKeyAt(canonical); ok {
		if store.Repositories == nil {
			store.Repositories = map[string]contextBinding{}
		}
		store.Repositories[key] = binding
		if err := writeContextStore(agentDir, store); err != nil {
			return resolvedActivationBinding{}, err
		}
		copy := binding
		return resolvedActivationBinding{Key: key, Source: "repository", Binding: &copy}, nil
	}
	if store.Directories == nil {
		store.Directories = map[string]contextBinding{}
	}
	store.Directories[canonical] = binding
	if err := writeContextStore(agentDir, store); err != nil {
		return resolvedActivationBinding{}, err
	}
	copy := binding
	return resolvedActivationBinding{Key: "dir:" + canonical, Source: "directory", Directory: canonical, Binding: &copy}, nil
}

func clearContextBinding(agentDir, directory string, clearDefault bool, directoryOverride string) (string, error) {
	store, err := readContextStore(agentDir)
	if err != nil {
		return "", err
	}
	if clearDefault {
		store.Default = nil
		return "default", writeContextStore(agentDir, store)
	}
	canonical, err := canonicalDirectory(firstNonEmpty(directoryOverride, directory))
	if err != nil {
		return "", err
	}
	if directoryOverride != "" {
		delete(store.Directories, canonical)
		return "dir:" + canonical, writeContextStore(agentDir, store)
	}
	resolved, err := resolveContextBinding(agentDir, canonical)
	if err != nil {
		return "", err
	}
	if resolved.Source == "directory" {
		delete(store.Directories, resolved.Directory)
		return resolved.Key, writeContextStore(agentDir, store)
	}
	if key, ok := gitRemoteKeyAt(canonical); ok {
		delete(store.Repositories, key)
		return key, writeContextStore(agentDir, store)
	}
	delete(store.Directories, canonical)
	return "dir:" + canonical, writeContextStore(agentDir, store)
}

func contextStoreKeys(store *contextStore) []string {
	keys := make([]string, 0, len(store.Repositories)+len(store.Directories))
	for key := range store.Repositories {
		keys = append(keys, key)
	}
	for key := range store.Directories {
		keys = append(keys, "dir:"+key)
	}
	sort.Strings(keys)
	return keys
}
