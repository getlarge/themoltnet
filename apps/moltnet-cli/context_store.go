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
	"strings"

	"github.com/getlarge/themoltnet/apps/moltnet-cli/internal/safefile"
)

const contextStoreVersion = 1

const maxContextStoreBytes = 1 << 20

// A resolved context comes from exactly one of two places, and both are
// reported so the user can always see which one applied.
const (
	// contextSourceLocation: a binding stored for this location.
	contextSourceLocation = "location"
	// contextSourceIdentityDefault: no binding for this location, so the
	// identity-wide MOLTNET_TEAM_ID / MOLTNET_DIARY_ID from the identity env
	// file apply — the same values used before per-location contexts existed.
	contextSourceIdentityDefault = "identity-default"
)

type contextBinding struct {
	TeamID  string `json:"teamId"`
	DiaryID string `json:"diaryId"`
}

// contextStore maps a location key to its team/diary binding.
//
// A location is the normalized Git remote when the directory is inside a
// repository that has one, and the canonical directory otherwise. There is
// deliberately no ancestor lookup, no directory override, and no stored
// default: one location has one key and one lookup, so there is no precedence
// between bindings to get wrong. The identity-wide default stays where it has
// always lived, in the identity env file.
type contextStore struct {
	Version  int                       `json:"version"`
	Contexts map[string]contextBinding `json:"contexts,omitempty"`
}

type resolvedContextBinding struct {
	Key string
	// Source is contextSourceLocation, contextSourceIdentityDefault, or empty
	// when neither applies.
	Source  string
	Binding *contextBinding
}

func (r resolvedContextBinding) teamID() string {
	if r.Binding == nil {
		return ""
	}
	return r.Binding.TeamID
}

func (r resolvedContextBinding) diaryID() string {
	if r.Binding == nil {
		return ""
	}
	return r.Binding.DiaryID
}

func contextStorePath(agentDir string) string {
	return filepath.Join(agentDir, "contexts.json")
}

func readContextStore(agentDir string) (*contextStore, error) {
	path := contextStorePath(agentDir)
	data, err := safefile.ReadBoundedRegularFile(path, maxContextStoreBytes)
	if errors.Is(err, os.ErrNotExist) {
		return &contextStore{Version: contextStoreVersion}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", path, err)
	}
	var store contextStore
	if err := json.Unmarshal(data, &store); err != nil {
		return nil, fmt.Errorf("parse %s: %w", path, err)
	}
	if store.Version != contextStoreVersion {
		return nil, fmt.Errorf("%s has version %d, but this CLI understands version %d; it was likely written by a newer moltnet release", path, store.Version, contextStoreVersion)
	}
	return &store, nil
}

// updateContextStore applies mutate as one read-modify-write under the store's
// writer lock, so concurrent `context set` / `clear` runs cannot drop each
// other's bindings.
func updateContextStore(agentDir string, mutate func(*contextStore)) error {
	lock, err := safefile.Acquire(contextStorePath(agentDir))
	if err != nil {
		return err
	}
	defer lock.Close()
	store, err := readContextStore(agentDir)
	if err != nil {
		return err
	}
	mutate(store)
	store.Version = contextStoreVersion
	if len(store.Contexts) == 0 {
		store.Contexts = nil
	}
	data, err := json.MarshalIndent(store, "", "  ")
	if err != nil {
		return err
	}
	if err := lock.Write(append(data, '\n')); err != nil {
		return fmt.Errorf("write context store: %w", err)
	}
	return nil
}

// normalizeGitRemoteKey reduces a remote URL to a provider-neutral key, so
// every clone and worktree of one repository shares one binding. Credentials,
// protocol, port, a trailing slash and a `.git` suffix are dropped, and the
// key is lowercased because hosts and the common forges treat repository
// paths case-insensitively.
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
	// Trim the slashes first: "…/repo.git/" would otherwise keep its suffix,
	// because TrimSuffix sees the trailing slash.
	repositoryPath := strings.TrimSuffix(strings.Trim(parsed.EscapedPath(), "/"), ".git")
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
	return "git:" + host + "/" + strings.ToLower(decoded), nil
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

// contextLocationKey returns the key for directory (or the working directory):
// its normalized Git remote, or "dir:" plus the canonical directory outside a
// repository.
func contextLocationKey(directory string) (string, error) {
	canonical, err := canonicalDirectory(directory)
	if err != nil {
		return "", err
	}
	if key, ok := gitRemoteKeyAt(canonical); ok {
		return key, nil
	}
	return "dir:" + canonical, nil
}

// identityDefaultBinding returns the identity-wide team/diary pair from the
// identity env file, when both are set.
func identityDefaultBinding(agentDir string) (contextBinding, bool) {
	env, err := parseEnvFile(filepath.Join(agentDir, "env"))
	if err != nil {
		return contextBinding{}, false
	}
	binding := contextBinding{
		TeamID:  strings.TrimSpace(env["MOLTNET_TEAM_ID"]),
		DiaryID: strings.TrimSpace(env["MOLTNET_DIARY_ID"]),
	}
	if binding.TeamID == "" || binding.DiaryID == "" {
		return contextBinding{}, false
	}
	return binding, true
}

// resolveContextBinding resolves the team/diary for directory: the binding
// stored for its location if there is one, otherwise the identity default.
func resolveContextBinding(agentDir, directory string) (resolvedContextBinding, error) {
	key, err := contextLocationKey(directory)
	if err != nil {
		return resolvedContextBinding{}, err
	}
	store, err := readContextStore(agentDir)
	if err != nil {
		return resolvedContextBinding{}, err
	}
	if binding, ok := store.Contexts[key]; ok {
		copy := binding
		return resolvedContextBinding{Key: key, Source: contextSourceLocation, Binding: &copy}, nil
	}
	if binding, ok := identityDefaultBinding(agentDir); ok {
		return resolvedContextBinding{Key: key, Source: contextSourceIdentityDefault, Binding: &binding}, nil
	}
	return resolvedContextBinding{Key: key}, nil
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

// setContextBinding binds directory's location (the working directory when
// empty) to binding.
func setContextBinding(agentDir, directory string, binding contextBinding) (resolvedContextBinding, error) {
	if err := validateContextBinding(binding); err != nil {
		return resolvedContextBinding{}, err
	}
	key, err := contextLocationKey(directory)
	if err != nil {
		return resolvedContextBinding{}, err
	}
	if err := updateContextStore(agentDir, func(store *contextStore) {
		if store.Contexts == nil {
			store.Contexts = map[string]contextBinding{}
		}
		store.Contexts[key] = binding
	}); err != nil {
		return resolvedContextBinding{}, err
	}
	copy := binding
	return resolvedContextBinding{Key: key, Source: contextSourceLocation, Binding: &copy}, nil
}

// clearContextBinding removes the binding for directory's location. It reports
// whether one existed, so callers never announce a change that did not happen.
func clearContextBinding(agentDir, directory string) (string, bool, error) {
	key, err := contextLocationKey(directory)
	if err != nil {
		return "", false, err
	}
	removed := false
	if err := updateContextStore(agentDir, func(store *contextStore) {
		if _, ok := store.Contexts[key]; ok {
			delete(store.Contexts, key)
			removed = true
		}
	}); err != nil {
		return "", false, err
	}
	return key, removed, nil
}
