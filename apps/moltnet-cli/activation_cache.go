package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const activationCacheVersion = 1

var requiredActivationInputs = []string{"credentials", "env", "gitconfig", "sshPublicKey"}

type activationCache struct {
	Version         int                             `json:"version"`
	AgentName       string                          `json:"agentName"`
	RepoRoot        string                          `json:"repoRoot"`
	RepoName        string                          `json:"repoName"`
	Fingerprint     string                          `json:"fingerprint"`
	DiaryID         string                          `json:"diaryId,omitempty"`
	TeamID          string                          `json:"teamId,omitempty"`
	GitConfigGlobal string                          `json:"gitConfigGlobal"`
	CredentialsPath string                          `json:"credentialsPath"`
	AuthorshipMode  string                          `json:"authorshipMode"`
	AgentEmail      string                          `json:"agentEmail"`
	Inputs          map[string]activationCacheInput `json:"inputs"`
	CreatedAt       string                          `json:"createdAt"`
}

type activationCacheInput struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
}

type activationValidationResult struct {
	Valid           bool     `json:"valid"`
	Reason          string   `json:"reason,omitempty"`
	Changed         []string `json:"changed,omitempty"`
	AgentName       string   `json:"agentName,omitempty"`
	Fingerprint     string   `json:"fingerprint,omitempty"`
	DiaryID         string   `json:"diaryId,omitempty"`
	TeamID          string   `json:"teamId,omitempty"`
	CredentialsPath string   `json:"credentialsPath,omitempty"`
	GitConfigGlobal string   `json:"gitConfigGlobal,omitempty"`
}

type activationContext struct {
	MoltnetDir string
	AgentDir   string
	AgentName  string
	RepoRoot   string
	RepoName   string
	EnvPath    string
	EnvVars    map[string]string
	CachePath  string
}

func runAgentsActivationValidateCmd(w io.Writer, dir, agent string, jsonOut bool) error {
	ctx, err := resolveActivationContext(dir, agent)
	if err != nil {
		return err
	}
	result, err := validateActivationCache(ctx)
	if err != nil {
		return err
	}
	return printActivationValidationResult(w, result, jsonOut)
}

func runAgentsActivationRefreshCmd(w io.Writer, dir, agent string, jsonOut bool) error {
	ctx, err := resolveActivationContext(dir, agent)
	if err != nil {
		return err
	}
	cache, err := buildActivationCache(ctx)
	if err != nil {
		return err
	}
	if err := writeActivationCache(ctx.CachePath, cache); err != nil {
		return err
	}
	result := activationValidationResult{
		Valid:           true,
		AgentName:       cache.AgentName,
		Fingerprint:     cache.Fingerprint,
		DiaryID:         cache.DiaryID,
		TeamID:          cache.TeamID,
		CredentialsPath: cache.CredentialsPath,
		GitConfigGlobal: cache.GitConfigGlobal,
	}
	return printActivationValidationResult(w, &result, jsonOut)
}

func runAgentsActivationClearCmd(w io.Writer, dir, agent string) error {
	ctx, err := resolveActivationContext(dir, agent)
	if err != nil {
		return err
	}
	if err := os.Remove(ctx.CachePath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("remove activation cache: %w", err)
	}
	fmt.Fprintf(w, "Activation cache cleared: %s\n", ctx.CachePath)
	return nil
}

func resolveActivationContext(dir, agentFlag string) (*activationContext, error) {
	absDir, err := filepath.Abs(dir)
	if err != nil {
		return nil, fmt.Errorf("resolve dir: %w", err)
	}
	moltnetDir, err := resolveMoltnetDir(absDir)
	if err != nil {
		return nil, err
	}
	agentName, err := resolveAgentName(moltnetDir, agentFlag)
	if err != nil {
		return nil, err
	}
	agentDir := filepath.Join(moltnetDir, agentName)
	envPath := filepath.Join(agentDir, "env")
	envVars, err := parseEnvFile(envPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			envVars = map[string]string{}
		} else {
			return nil, fmt.Errorf("read env file: %w", err)
		}
	}
	repoRoot, err := resolveRepoRoot(absDir)
	if err != nil {
		return nil, err
	}
	return &activationContext{
		MoltnetDir: moltnetDir,
		AgentDir:   agentDir,
		AgentName:  agentName,
		RepoRoot:   repoRoot,
		RepoName:   filepath.Base(repoRoot),
		EnvPath:    envPath,
		EnvVars:    envVars,
		CachePath:  filepath.Join(agentDir, "activation-cache.json"),
	}, nil
}

func resolveRepoRoot(dir string) (string, error) {
	cmd := exec.Command("git", "rev-parse", "--show-toplevel")
	cmd.Dir = dir
	out, err := cmd.Output()
	if err == nil {
		return filepath.Clean(strings.TrimSpace(string(out))), nil
	}
	abs, absErr := filepath.Abs(dir)
	if absErr != nil {
		return "", fmt.Errorf("resolve repo root: %w", absErr)
	}
	return filepath.Clean(abs), nil
}

func buildActivationCache(ctx *activationContext) (*activationCache, error) {
	credentialsPath := filepath.Join(ctx.AgentDir, "moltnet.json")
	creds, err := ReadConfigFrom(credentialsPath)
	if err != nil {
		return nil, err
	}
	if creds == nil {
		return nil, fmt.Errorf("credentials not found at %s", credentialsPath)
	}

	gitConfigGlobal := firstNonEmpty(ctx.EnvVars["GIT_CONFIG_GLOBAL"], valueOrEmpty(creds.Git, func(g *GitSection) string {
		return g.ConfigPath
	}), filepath.Join(".moltnet", ctx.AgentName, "gitconfig"))
	gitconfigPath := resolveMaybeRelative(ctx.RepoRoot, gitConfigGlobal)

	gitIdentity, err := readActivationGitIdentity(gitconfigPath)
	if err != nil {
		return nil, err
	}
	if gitIdentity.Email == "" || gitIdentity.SigningKey == "" || gitIdentity.GPGFormat != "ssh" {
		return nil, fmt.Errorf("gitconfig %s is missing user.email, user.signingkey, or gpg.format=ssh", gitconfigPath)
	}
	authorshipMode := firstNonEmpty(ctx.EnvVars["MOLTNET_COMMIT_AUTHORSHIP"], "agent")
	fingerprint := firstNonEmpty(ctx.EnvVars["MOLTNET_FINGERPRINT"], creds.Keys.Fingerprint)
	if fingerprint == "" {
		return nil, fmt.Errorf("missing fingerprint in env or moltnet.json")
	}

	inputs := map[string]activationCacheInput{}
	for name, path := range map[string]string{
		"env":          ctx.EnvPath,
		"gitconfig":    gitconfigPath,
		"credentials":  credentialsPath,
		"sshPublicKey": firstNonEmpty(valueOrEmpty(creds.SSH, func(s *SSHSection) string { return s.PublicKeyPath }), filepath.Join(ctx.AgentDir, "ssh", "id_ed25519.pub")),
	} {
		input, err := hashActivationInput(ctx.RepoRoot, path)
		if err != nil {
			return nil, err
		}
		inputs[name] = input
	}

	now := time.Now().UTC().Format(time.RFC3339)
	return &activationCache{
		Version:         activationCacheVersion,
		AgentName:       ctx.AgentName,
		RepoRoot:        ctx.RepoRoot,
		RepoName:        ctx.RepoName,
		Fingerprint:     fingerprint,
		DiaryID:         ctx.EnvVars["MOLTNET_DIARY_ID"],
		TeamID:          ctx.EnvVars["MOLTNET_TEAM_ID"],
		GitConfigGlobal: gitConfigGlobal,
		CredentialsPath: relativeToRepo(ctx.RepoRoot, credentialsPath),
		AuthorshipMode:  authorshipMode,
		AgentEmail:      gitIdentity.Email,
		Inputs:          inputs,
		CreatedAt:       now,
	}, nil
}

func validateActivationCache(ctx *activationContext) (*activationValidationResult, error) {
	cache, err := readActivationCache(ctx.CachePath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return &activationValidationResult{Valid: false, Reason: "cache_missing"}, nil
		}
		var jsonSyntaxErr *json.SyntaxError
		var jsonTypeErr *json.UnmarshalTypeError
		if errors.As(err, &jsonSyntaxErr) || errors.As(err, &jsonTypeErr) {
			return invalidActivation("cache_corrupted", nil), nil
		}
		return nil, err
	}
	if cache.Version != activationCacheVersion {
		return invalidActivation("version_mismatch", nil), nil
	}
	if cache.AgentName != ctx.AgentName {
		return invalidActivation("agent_mismatch", nil), nil
	}
	if filepath.Clean(cache.RepoRoot) != ctx.RepoRoot {
		return invalidActivation("repo_mismatch", nil), nil
	}

	var changed []string
	for _, name := range requiredActivationInputs {
		if _, ok := cache.Inputs[name]; !ok {
			changed = append(changed, name)
		}
	}
	for _, cached := range cache.Inputs {
		current, err := hashActivationInput(ctx.RepoRoot, cached.Path)
		if err != nil {
			changed = append(changed, cached.Path)
			continue
		}
		if current.SHA256 != cached.SHA256 {
			changed = append(changed, cached.Path)
		}
	}
	for _, envKey := range []struct {
		key   string
		value string
	}{
		{"MOLTNET_AGENT_NAME", cache.AgentName},
		{"MOLTNET_FINGERPRINT", cache.Fingerprint},
		{"MOLTNET_DIARY_ID", cache.DiaryID},
		{"MOLTNET_TEAM_ID", cache.TeamID},
	} {
		if v := ctx.EnvVars[envKey.key]; v != "" && v != envKey.value {
			changed = append(changed, relativeToRepo(ctx.RepoRoot, ctx.EnvPath))
		}
	}
	if len(changed) > 0 {
		sort.Strings(changed)
		return invalidActivation("input_hash_mismatch", uniqueStrings(changed)), nil
	}

	return &activationValidationResult{
		Valid:           true,
		AgentName:       cache.AgentName,
		Fingerprint:     cache.Fingerprint,
		DiaryID:         cache.DiaryID,
		TeamID:          cache.TeamID,
		CredentialsPath: cache.CredentialsPath,
		GitConfigGlobal: cache.GitConfigGlobal,
	}, nil
}

func readActivationCache(path string) (*activationCache, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var cache activationCache
	if err := json.Unmarshal(data, &cache); err != nil {
		return nil, fmt.Errorf("parse activation cache: %w", err)
	}
	return &cache, nil
}

func writeActivationCache(path string, cache *activationCache) error {
	data, err := json.MarshalIndent(cache, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal activation cache: %w", err)
	}
	data = append(data, '\n')
	if err := os.WriteFile(path, data, 0o600); err != nil {
		return fmt.Errorf("write activation cache: %w", err)
	}
	return nil
}

func hashActivationInput(repoRoot, path string) (activationCacheInput, error) {
	resolved := resolveMaybeRelative(repoRoot, path)
	data, err := os.ReadFile(resolved)
	if err != nil {
		return activationCacheInput{}, fmt.Errorf("read activation input %s: %w", path, err)
	}
	sum := sha256.Sum256(data)
	return activationCacheInput{
		Path:   relativeToRepo(repoRoot, resolved),
		SHA256: hex.EncodeToString(sum[:]),
	}, nil
}

type activationGitIdentity struct {
	Name       string
	Email      string
	SigningKey string
	GPGFormat  string
}

func readActivationGitIdentity(gitconfigPath string) (activationGitIdentity, error) {
	name, err := readGitConfigValue(gitconfigPath, "user.name")
	if err != nil {
		return activationGitIdentity{}, err
	}
	email, err := readGitConfigValue(gitconfigPath, "user.email")
	if err != nil {
		return activationGitIdentity{}, err
	}
	signingKey, err := readGitConfigValue(gitconfigPath, "user.signingkey")
	if err != nil {
		return activationGitIdentity{}, err
	}
	gpgFormat, err := readGitConfigValue(gitconfigPath, "gpg.format")
	if err != nil {
		return activationGitIdentity{}, err
	}
	return activationGitIdentity{
		Name:       name,
		Email:      email,
		SigningKey: signingKey,
		GPGFormat:  gpgFormat,
	}, nil
}

func readGitConfigValue(gitconfigPath, key string) (string, error) {
	cmd := exec.Command("git", "config", "--file", gitconfigPath, "--get", key)
	out, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("git config %s: %w", key, err)
	}
	return strings.TrimSpace(string(out)), nil
}

func printActivationValidationResult(w io.Writer, result *activationValidationResult, jsonOut bool) error {
	if jsonOut {
		data, err := json.MarshalIndent(result, "", "  ")
		if err != nil {
			return err
		}
		fmt.Fprintln(w, string(data))
		return nil
	}
	if result.Valid {
		fmt.Fprintf(w, "Activation cache valid for %s (%s)\n", result.AgentName, result.Fingerprint)
		return nil
	}
	if len(result.Changed) > 0 {
		fmt.Fprintf(w, "Activation cache invalid: %s (%s)\n", result.Reason, strings.Join(result.Changed, ", "))
		return nil
	}
	fmt.Fprintf(w, "Activation cache invalid: %s\n", result.Reason)
	return nil
}

func invalidActivation(reason string, changed []string) *activationValidationResult {
	return &activationValidationResult{Valid: false, Reason: reason, Changed: changed}
}

func resolveMaybeRelative(repoRoot, path string) string {
	if filepath.IsAbs(path) {
		return filepath.Clean(path)
	}
	return filepath.Clean(filepath.Join(repoRoot, path))
}

func relativeToRepo(repoRoot, path string) string {
	abs := resolveMaybeRelative(repoRoot, path)
	rel, err := filepath.Rel(repoRoot, abs)
	if err != nil || strings.HasPrefix(rel, "..") {
		return abs
	}
	return rel
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func valueOrEmpty[T any](value *T, getter func(*T) string) string {
	if value == nil {
		return ""
	}
	return getter(value)
}

func uniqueStrings(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	seen := make(map[string]bool, len(values))
	var out []string
	for _, value := range values {
		if seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	return out
}
