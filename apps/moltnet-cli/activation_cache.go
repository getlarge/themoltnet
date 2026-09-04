package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"maps"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// Version 5 moves activation state into the selected central identity. Older
// repository-bound cache files deliberately fail validation rather than being
// discovered or reused.
const activationCacheVersion = 5

var requiredActivationInputs = []string{"credentials", "env", "gitconfig", "sshPublicKey"}

type activationCache struct {
	Version              int                             `json:"version"`
	AgentName            string                          `json:"agentName"`
	Fingerprint          string                          `json:"fingerprint"`
	DiaryID              string                          `json:"diaryId,omitempty"`
	TeamID               string                          `json:"teamId,omitempty"`
	GitConfigGlobal      string                          `json:"gitConfigGlobal"`
	CredentialsPath      string                          `json:"credentialsPath"`
	AuthorshipMode       string                          `json:"authorshipMode"`
	AuthorshipConfigured bool                            `json:"authorshipConfigured"`
	HumanGitIdentity     string                          `json:"humanGitIdentity,omitempty"`
	AgentEmail           string                          `json:"agentEmail"`
	GitHubAppConfigured  bool                            `json:"githubAppConfigured"`
	CredentialProvider   string                          `json:"credentialProvider"`
	CredentialProviders  map[string]string               `json:"credentialProviders"`
	CredentialStatus     string                          `json:"credentialStatus"`
	RegisteredAt         string                          `json:"registeredAt,omitempty"`
	Inputs               map[string]activationCacheInput `json:"inputs"`
	CreatedAt            string                          `json:"createdAt"`
}

type activationCacheInput struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
}

type activationValidationResult struct {
	Valid                      bool              `json:"valid"`
	Reason                     string            `json:"reason,omitempty"`
	Changed                    []string          `json:"changed,omitempty"`
	AgentName                  string            `json:"agentName,omitempty"`
	Fingerprint                string            `json:"fingerprint,omitempty"`
	DiaryID                    string            `json:"diaryId,omitempty"`
	TeamID                     string            `json:"teamId,omitempty"`
	CredentialsPath            string            `json:"credentialsPath,omitempty"`
	GitConfigGlobal            string            `json:"gitConfigGlobal,omitempty"`
	AuthorshipMode             string            `json:"authorshipMode,omitempty"`
	AuthorshipConfigured       bool              `json:"authorshipConfigured"`
	HumanGitIdentity           string            `json:"humanGitIdentity,omitempty"`
	HumanGitIdentityConfigured bool              `json:"humanGitIdentityConfigured"`
	AgentEmail                 string            `json:"agentEmail,omitempty"`
	GitHubAppConfigured        bool              `json:"githubAppConfigured"`
	CredentialProvider         string            `json:"credentialProvider,omitempty"`
	CredentialProviders        map[string]string `json:"credentialProviders,omitempty"`
	CredentialStatus           string            `json:"credentialStatus,omitempty"`
	RegisteredAt               string            `json:"registeredAt,omitempty"`
}

type activationContext struct {
	AgentDir  string
	AgentName string
	EnvPath   string
	EnvVars   map[string]string
	CachePath string
}

func runAgentsActivationValidateCmd(w io.Writer, identity string, jsonOut bool) error {
	ctx, err := resolveActivationContext(identity)
	if err != nil {
		return err
	}
	result, err := validateActivationCache(ctx)
	if err != nil {
		return err
	}
	return printActivationValidationResult(w, result, jsonOut)
}

func runAgentsActivationRefreshCmd(w io.Writer, identity string, args ...any) error {
	jsonOut, err := activationJSONOutput(args)
	if err != nil {
		return err
	}
	if len(args) == 2 {
		legacyIdentity, ok := args[0].(string)
		if !ok {
			return fmt.Errorf("invalid activation identity")
		}
		identity = legacyIdentity
	}
	ctx, err := resolveActivationContext(identity)
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
	result := activationResultFromCache(cache)
	return printActivationValidationResult(w, &result, jsonOut)
}

func runAgentsActivationClearCmd(w io.Writer, identity string, ignoredLegacySelector ...string) error {
	if len(ignoredLegacySelector) > 0 {
		identity = ignoredLegacySelector[len(ignoredLegacySelector)-1]
	}
	ctx, err := resolveActivationContext(identity)
	if err != nil {
		return err
	}
	if err := os.Remove(ctx.CachePath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("remove activation cache: %w", err)
	}
	fmt.Fprintf(w, "Activation cache cleared: %s\n", ctx.CachePath)
	return nil
}

func resolveActivationContext(identity string, ignoredLegacySelector ...string) (*activationContext, error) {
	if len(ignoredLegacySelector) > 0 {
		identity = ignoredLegacySelector[len(ignoredLegacySelector)-1]
	}
	agentName, err := resolveIdentityAlias(identity)
	if err != nil {
		return nil, err
	}
	agentDir, err := identityDir(agentName)
	if err != nil {
		return nil, err
	}
	envPath := filepath.Join(agentDir, "env")
	envVars, err := parseEnvFile(envPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			envVars = map[string]string{}
		} else {
			return nil, fmt.Errorf("read env file: %w", err)
		}
	}
	return &activationContext{
		AgentDir:  agentDir,
		AgentName: agentName,
		EnvPath:   envPath,
		EnvVars:   envVars,
		CachePath: filepath.Join(agentDir, "activation-cache.json"),
	}, nil
}

func activationJSONOutput(args []any) (bool, error) {
	switch len(args) {
	case 1:
		jsonOut, ok := args[0].(bool)
		if !ok {
			return false, fmt.Errorf("invalid activation JSON option")
		}
		return jsonOut, nil
	case 2:
		jsonOut, ok := args[1].(bool)
		if !ok {
			return false, fmt.Errorf("invalid activation JSON option")
		}
		return jsonOut, nil
	default:
		return false, fmt.Errorf("invalid activation options")
	}
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
	}), "gitconfig")
	paths := newAgentPathResolver(ctx.AgentDir, ctx.AgentDir, ctx.AgentName)
	gitconfigPath := paths.resolveFile(gitConfigGlobal, "gitconfig")

	gitIdentity, err := readActivationGitIdentity(gitconfigPath)
	if err != nil {
		return nil, err
	}
	if gitIdentity.Email == "" || gitIdentity.SigningKey == "" || gitIdentity.GPGFormat != "ssh" {
		return nil, fmt.Errorf("gitconfig %s is missing user.email, user.signingkey, or gpg.format=ssh", gitconfigPath)
	}
	authorshipMode := strings.TrimSpace(ctx.EnvVars["MOLTNET_COMMIT_AUTHORSHIP"])
	authorshipConfigured := authorshipMode != ""
	if !authorshipConfigured {
		authorshipMode = "agent"
	}
	credentialProviders := activationCredentialProviders(creds)
	credentialProvider := credentialProviders[activationCredentialOAuth2]
	credentialStatus := "missing"
	if creds.OAuth2.ClientSecret != "" {
		credentialStatus = "available"
	}
	if creds.OAuth2.ClientSecretRef != nil {
		credentialStatus = "configured"
	}
	fingerprint := firstNonEmpty(ctx.EnvVars["MOLTNET_FINGERPRINT"], creds.Keys.Fingerprint)
	if fingerprint == "" {
		return nil, fmt.Errorf("missing fingerprint in env or moltnet.json")
	}

	inputs := map[string]activationCacheInput{}
	sshPublicKeyPath := paths.resolveFile(
		valueOrEmpty(creds.SSH, func(s *SSHSection) string { return s.PublicKeyPath }),
		filepath.Join("ssh", "id_ed25519.pub"),
	)
	for name, path := range map[string]string{
		"env":          ctx.EnvPath,
		"gitconfig":    gitconfigPath,
		"credentials":  credentialsPath,
		"sshPublicKey": sshPublicKeyPath,
	} {
		input, err := hashActivationInput(ctx.AgentDir, path)
		if err != nil {
			return nil, err
		}
		inputs[name] = input
	}

	now := time.Now().UTC().Format(time.RFC3339)
	return &activationCache{
		Version:              activationCacheVersion,
		AgentName:            ctx.AgentName,
		Fingerprint:          fingerprint,
		DiaryID:              ctx.EnvVars["MOLTNET_DIARY_ID"],
		TeamID:               ctx.EnvVars["MOLTNET_TEAM_ID"],
		GitConfigGlobal:      relativeToRepo(ctx.AgentDir, gitconfigPath),
		CredentialsPath:      relativeToRepo(ctx.AgentDir, credentialsPath),
		AuthorshipMode:       authorshipMode,
		AuthorshipConfigured: authorshipConfigured,
		HumanGitIdentity:     ctx.EnvVars["MOLTNET_HUMAN_GIT_IDENTITY"],
		AgentEmail:           gitIdentity.Email,
		GitHubAppConfigured:  creds.GitHub != nil && creds.GitHub.AppID != "" && (creds.GitHub.PrivateKeyPath != "" || creds.GitHub.PrivateKeyRef != nil),
		CredentialProvider:   credentialProvider,
		CredentialProviders:  credentialProviders,
		CredentialStatus:     credentialStatus,
		RegisteredAt:         creds.RegisteredAt,
		Inputs:               inputs,
		CreatedAt:            now,
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
	current, err := buildActivationCache(ctx)
	if err != nil {
		// A vanished or unreadable cache input is an expected invalidation, not
		// a command failure. Keep validation machine-readable so activation can
		// route through the documented cold ceremony.
		return invalidActivation("input_unavailable", nil), nil
	}

	var changed []string
	for _, name := range requiredActivationInputs {
		cached, ok := cache.Inputs[name]
		if !ok {
			changed = append(changed, name)
			continue
		}
		expected := current.Inputs[name]
		if filepath.Clean(cached.Path) != filepath.Clean(expected.Path) || cached.SHA256 != expected.SHA256 {
			changed = append(changed, expected.Path)
		}
	}
	if len(changed) > 0 {
		sort.Strings(changed)
		return invalidActivation("input_hash_mismatch", uniqueStrings(changed)), nil
	}
	if !activationMetadataEqual(cache, current) {
		return invalidActivation("cache_metadata_mismatch", []string{relativeToRepo(ctx.AgentDir, ctx.CachePath)}), nil
	}

	result := activationResultFromCache(current)
	return &result, nil
}

// activationCredential* are the per-kind keys of
// activationCache.CredentialProviders. Each value is the provider name of the
// configured reference, or one of the activationProvider* markers for a
// legacy plaintext value, a legacy file path, or no credential of that kind.
// Only metadata is recorded; the referenced secrets are never read during
// activation.
const (
	activationCredentialOAuth2       = "oauth2"
	activationCredentialIdentitySeed = "identitySeed"
	activationCredentialGitHubApp    = "githubApp"
	activationCredentialAgentKey     = "agentKey"

	activationProviderLegacyPlaintext = "legacy-plaintext"
	activationProviderLegacyFile      = "legacy-file"
	activationProviderAbsent          = "absent"
)

func activationCredentialProviders(creds *CredentialsFile) map[string]string {
	providers := map[string]string{
		activationCredentialOAuth2:       activationProviderLegacyPlaintext,
		activationCredentialIdentitySeed: activationProviderAbsent,
		activationCredentialGitHubApp:    activationProviderAbsent,
		activationCredentialAgentKey:     activationProviderAbsent,
	}
	if creds.OAuth2.ClientSecretRef != nil {
		providers[activationCredentialOAuth2] = creds.OAuth2.ClientSecretRef.Provider
	}
	switch {
	case creds.Keys.PrivateKeyRef != nil:
		providers[activationCredentialIdentitySeed] = creds.Keys.PrivateKeyRef.Provider
	case strings.TrimSpace(creds.Keys.PrivateKey) != "":
		providers[activationCredentialIdentitySeed] = activationProviderLegacyPlaintext
	}
	if creds.GitHub != nil {
		switch {
		case creds.GitHub.PrivateKeyRef != nil:
			providers[activationCredentialGitHubApp] = creds.GitHub.PrivateKeyRef.Provider
		case strings.TrimSpace(creds.GitHub.PrivateKeyPath) != "":
			providers[activationCredentialGitHubApp] = activationProviderLegacyFile
		}
	}
	if creds.AgentKeyRef != nil {
		providers[activationCredentialAgentKey] = creds.AgentKeyRef.Provider
	}
	return providers
}

func activationMetadataEqual(cached, current *activationCache) bool {
	return cached.Version == current.Version &&
		cached.AgentName == current.AgentName &&
		cached.Fingerprint == current.Fingerprint &&
		cached.DiaryID == current.DiaryID &&
		cached.TeamID == current.TeamID &&
		cached.GitConfigGlobal == current.GitConfigGlobal &&
		cached.CredentialsPath == current.CredentialsPath &&
		cached.AuthorshipMode == current.AuthorshipMode &&
		cached.AuthorshipConfigured == current.AuthorshipConfigured &&
		cached.HumanGitIdentity == current.HumanGitIdentity &&
		cached.AgentEmail == current.AgentEmail &&
		cached.GitHubAppConfigured == current.GitHubAppConfigured &&
		cached.CredentialProvider == current.CredentialProvider &&
		maps.Equal(cached.CredentialProviders, current.CredentialProviders) &&
		cached.CredentialStatus == current.CredentialStatus &&
		cached.RegisteredAt == current.RegisteredAt
}

func activationResultFromCache(cache *activationCache) activationValidationResult {
	return activationValidationResult{
		Valid:                      true,
		AgentName:                  cache.AgentName,
		Fingerprint:                cache.Fingerprint,
		DiaryID:                    cache.DiaryID,
		TeamID:                     cache.TeamID,
		CredentialsPath:            cache.CredentialsPath,
		GitConfigGlobal:            cache.GitConfigGlobal,
		AuthorshipMode:             cache.AuthorshipMode,
		AuthorshipConfigured:       cache.AuthorshipConfigured,
		HumanGitIdentity:           cache.HumanGitIdentity,
		HumanGitIdentityConfigured: cache.HumanGitIdentity != "",
		AgentEmail:                 cache.AgentEmail,
		GitHubAppConfigured:        cache.GitHubAppConfigured,
		CredentialProvider:         cache.CredentialProvider,
		CredentialProviders:        maps.Clone(cache.CredentialProviders),
		CredentialStatus:           cache.CredentialStatus,
		RegisteredAt:               cache.RegisteredAt,
	}
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
		value := any(result)
		if !result.Valid {
			value = struct {
				Valid   bool     `json:"valid"`
				Reason  string   `json:"reason,omitempty"`
				Changed []string `json:"changed,omitempty"`
			}{Valid: false, Reason: result.Reason, Changed: result.Changed}
		}
		data, err := json.MarshalIndent(value, "", "  ")
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
