package main

import (
	"bytes"
	"encoding/json"
	"io"
	"maps"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAgentsActivationValidateMissingCache(t *testing.T) {
	setupActivationCacheFixture(t)

	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "agents", "activation", "validate", "--identity", "test-agent", "--json")
	if err != nil {
		t.Fatalf("validate: %v", err)
	}

	var result activationValidationResult
	if err := json.Unmarshal([]byte(stdout), &result); err != nil {
		t.Fatalf("unmarshal result: %v\n%s", err, stdout)
	}
	if result.Valid {
		t.Fatal("expected missing cache to be invalid")
	}
	if result.Reason != "cache_missing" {
		t.Fatalf("reason = %q, want cache_missing", result.Reason)
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(stdout), &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload) != 2 {
		t.Fatalf("invalid activation output must contain only valid/reason, got %v", payload)
	}
}

func TestAgentsActivationValidateCorruptedCache(t *testing.T) {
	dir := setupActivationCacheFixture(t)
	cachePath := filepath.Join(dir, ".moltnet", "test-agent", "activation-cache.json")
	if err := os.WriteFile(cachePath, []byte("{not valid json"), 0o600); err != nil {
		t.Fatal(err)
	}

	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "agents", "activation", "validate", "--identity", "test-agent", "--json")
	if err != nil {
		t.Fatalf("validate: %v", err)
	}

	var result activationValidationResult
	if err := json.Unmarshal([]byte(stdout), &result); err != nil {
		t.Fatalf("unmarshal result: %v\n%s", err, stdout)
	}
	if result.Valid {
		t.Fatal("expected corrupted cache to be invalid")
	}
	if result.Reason != "cache_corrupted" {
		t.Fatalf("reason = %q, want cache_corrupted", result.Reason)
	}
}

func TestAgentsActivationRefreshThenValidate(t *testing.T) {
	dir := setupActivationCacheFixture(t)

	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "agents", "activation", "refresh", "--identity", "test-agent", "--json")
	if err != nil {
		t.Fatalf("refresh: %v", err)
	}

	var refreshResult activationValidationResult
	if err := json.Unmarshal([]byte(stdout), &refreshResult); err != nil {
		t.Fatalf("unmarshal refresh result: %v\n%s", err, stdout)
	}
	if !refreshResult.Valid {
		t.Fatalf("refresh valid = false, reason=%s", refreshResult.Reason)
	}
	if refreshResult.Fingerprint != "SHA256:testfingerprint" {
		t.Fatalf("fingerprint = %q", refreshResult.Fingerprint)
	}
	if refreshResult.DiaryID != "00000000-0000-4000-8000-000000000001" {
		t.Fatalf("diary id = %q", refreshResult.DiaryID)
	}
	if refreshResult.AuthorshipMode != "agent" || refreshResult.AgentEmail != "test-agent@example.com" {
		t.Fatalf("missing non-secret activation metadata: %+v", refreshResult)
	}
	if refreshResult.AuthorshipConfigured {
		t.Fatal("default authorship must remain distinguishable from explicit configuration")
	}
	if refreshResult.CredentialProvider != "legacy-plaintext" || refreshResult.CredentialStatus != "available" {
		t.Fatalf("credential status = %s/%s", refreshResult.CredentialProvider, refreshResult.CredentialStatus)
	}
	if refreshResult.HumanGitIdentityConfigured || refreshResult.HumanGitIdentity != "" {
		t.Fatalf("unexpected human identity metadata: %+v", refreshResult)
	}
	var refreshPayload map[string]any
	if err := json.Unmarshal([]byte(stdout), &refreshPayload); err != nil {
		t.Fatalf("unmarshal refresh payload: %v\n%s", err, stdout)
	}
	if _, ok := refreshPayload["transport"]; ok {
		t.Fatal("refresh result must not include session-local transport")
	}
	if payload := strings.ToLower(stdout); strings.Contains(payload, "clientsecret") || strings.Contains(payload, `"secret"`) {
		t.Fatal("activation result must not expose credential values")
	}
	cachePath := filepath.Join(dir, ".moltnet", "test-agent", "activation-cache.json")
	cacheData, err := os.ReadFile(cachePath)
	if err != nil {
		t.Fatalf("read cache: %v", err)
	}
	var cachePayload map[string]any
	if err := json.Unmarshal(cacheData, &cachePayload); err != nil {
		t.Fatalf("unmarshal cache: %v", err)
	}
	if _, ok := cachePayload["transport"]; ok {
		t.Fatal("activation cache must not persist session-local transport")
	}
	if _, ok := cachePayload["validatedAt"]; ok {
		t.Fatal("activation cache must not expose a misleading validatedAt timestamp")
	}

	validateRoot := NewRootCmd("test", "")
	stdout, _, err = executeCommand(validateRoot, "agents", "activation", "validate", "--identity", "test-agent", "--json")
	if err != nil {
		t.Fatalf("validate: %v", err)
	}
	var validateResult activationValidationResult
	if err := json.Unmarshal([]byte(stdout), &validateResult); err != nil {
		t.Fatalf("unmarshal validate result: %v\n%s", err, stdout)
	}
	if !validateResult.Valid {
		t.Fatalf("validate valid=false, reason=%s changed=%v", validateResult.Reason, validateResult.Changed)
	}
}

func TestAgentsActivationRefreshPreservesExplicitAuthorshipPresence(t *testing.T) {
	dir := setupActivationCacheFixture(t)
	envPath := filepath.Join(dir, ".moltnet", "test-agent", "env")
	data, err := os.ReadFile(envPath)
	if err != nil {
		t.Fatal(err)
	}
	data = append(data, []byte("MOLTNET_COMMIT_AUTHORSHIP='agent'\n")...)
	if err := os.WriteFile(envPath, data, 0o600); err != nil {
		t.Fatal(err)
	}

	ctx, err := resolveActivationContext("test-agent")
	if err != nil {
		t.Fatal(err)
	}
	cache, err := buildActivationCache(ctx)
	if err != nil {
		t.Fatal(err)
	}
	result := activationResultFromCache(cache)
	if !result.AuthorshipConfigured || result.AuthorshipMode != "agent" {
		t.Fatalf("explicit authorship presence was lost: %+v", result)
	}
}

func TestAgentsActivationRefreshRebasesPortedAbsolutePaths(t *testing.T) {
	dir := setupActivationCacheFixture(t)
	agentDir := filepath.Join(dir, ".moltnet", "test-agent")
	hostAgentDir := filepath.Join(
		string(filepath.Separator),
		"Users",
		"edouard",
		"Dev",
		"getlarge",
		"themolt",
		".moltnet",
		"test-agent",
	)
	hostGitconfig := filepath.Join(hostAgentDir, "gitconfig")
	hostSSHPublicKey := filepath.Join(hostAgentDir, "ssh", "id_ed25519.pub")

	env := strings.Join([]string{
		"MOLTNET_AGENT_NAME='test-agent'",
		"MOLTNET_FINGERPRINT='SHA256:testfingerprint'",
		"MOLTNET_DIARY_ID='00000000-0000-4000-8000-000000000001'",
		"MOLTNET_TEAM_ID='00000000-0000-4000-8000-000000000011'",
		"GIT_CONFIG_GLOBAL='" + hostGitconfig + "'",
		"",
	}, "\n")
	if err := os.WriteFile(filepath.Join(agentDir, "env"), []byte(env), 0o600); err != nil {
		t.Fatal(err)
	}

	configPath := filepath.Join(agentDir, "moltnet.json")
	creds, err := ReadConfigFrom(configPath)
	if err != nil {
		t.Fatalf("read config: %v", err)
	}
	creds.SSH.PublicKeyPath = hostSSHPublicKey
	if _, err := WriteConfigTo(creds, configPath); err != nil {
		t.Fatalf("write config: %v", err)
	}

	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "agents", "activation", "refresh", "--identity", "test-agent", "--json")
	if err != nil {
		t.Fatalf("refresh: %v", err)
	}

	var result activationValidationResult
	if err := json.Unmarshal([]byte(stdout), &result); err != nil {
		t.Fatalf("unmarshal refresh result: %v\n%s", err, stdout)
	}
	if !result.Valid {
		t.Fatalf("refresh valid = false, reason=%s", result.Reason)
	}
	if result.GitConfigGlobal != "gitconfig" {
		t.Fatalf("gitConfigGlobal = %q", result.GitConfigGlobal)
	}

	cache, err := readActivationCache(filepath.Join(agentDir, "activation-cache.json"))
	if err != nil {
		t.Fatalf("read cache: %v", err)
	}
	if cache.Inputs["gitconfig"].Path != "gitconfig" {
		t.Fatalf("gitconfig input path = %q", cache.Inputs["gitconfig"].Path)
	}
	if cache.Inputs["sshPublicKey"].Path != "ssh/id_ed25519.pub" {
		t.Fatalf("ssh public key input path = %q", cache.Inputs["sshPublicKey"].Path)
	}
}

func TestAgentsActivationValidateHashMismatch(t *testing.T) {
	dir := setupActivationCacheFixture(t)

	if err := runAgentsActivationRefreshCmd(io.Discard, "test-agent", true); err != nil {
		t.Fatalf("refresh: %v", err)
	}
	envPath := filepath.Join(dir, ".moltnet", "test-agent", "env")
	if err := os.WriteFile(envPath, []byte("MOLTNET_AGENT_NAME='test-agent'\nMOLTNET_FINGERPRINT='SHA256:testfingerprint'\nMOLTNET_DIARY_ID='00000000-0000-4000-8000-000000000002'\nMOLTNET_TEAM_ID='00000000-0000-4000-8000-000000000011'\nGIT_CONFIG_GLOBAL='.moltnet/test-agent/gitconfig'\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	ctx, err := resolveActivationContext(dir, "test-agent")
	if err != nil {
		t.Fatalf("context: %v", err)
	}
	result, err := validateActivationCache(ctx)
	if err != nil {
		t.Fatalf("validate: %v", err)
	}
	if result.Valid {
		t.Fatal("expected invalid cache")
	}
	if result.Reason != "input_hash_mismatch" {
		t.Fatalf("reason = %q", result.Reason)
	}
	if len(result.Changed) == 0 || !strings.Contains(strings.Join(result.Changed, ","), "env") {
		t.Fatalf("expected env in changed paths, got %v", result.Changed)
	}
}

func TestAgentsActivationValidateAgentMismatch(t *testing.T) {
	dir := setupActivationCacheFixture(t)

	if err := runAgentsActivationRefreshCmd(io.Discard, dir, "test-agent", true); err != nil {
		t.Fatalf("refresh: %v", err)
	}
	cachePath := filepath.Join(dir, ".moltnet", "test-agent", "activation-cache.json")
	cache, err := readActivationCache(cachePath)
	if err != nil {
		t.Fatalf("read cache: %v", err)
	}
	cache.AgentName = "other-agent"
	if err := writeActivationCache(cachePath, cache); err != nil {
		t.Fatalf("write cache: %v", err)
	}

	ctx, err := resolveActivationContext(dir, "test-agent")
	if err != nil {
		t.Fatalf("context: %v", err)
	}
	result, err := validateActivationCache(ctx)
	if err != nil {
		t.Fatalf("validate: %v", err)
	}
	if result.Valid || result.Reason != "agent_mismatch" {
		t.Fatalf("result = %+v, want agent_mismatch", result)
	}
}

func TestAgentsActivationValidateMissingRequiredInput(t *testing.T) {
	dir := setupActivationCacheFixture(t)

	if err := runAgentsActivationRefreshCmd(io.Discard, dir, "test-agent", true); err != nil {
		t.Fatalf("refresh: %v", err)
	}
	cachePath := filepath.Join(dir, ".moltnet", "test-agent", "activation-cache.json")
	cache, err := readActivationCache(cachePath)
	if err != nil {
		t.Fatalf("read cache: %v", err)
	}
	delete(cache.Inputs, "sshPublicKey")
	if err := writeActivationCache(cachePath, cache); err != nil {
		t.Fatalf("write cache: %v", err)
	}

	ctx, err := resolveActivationContext(dir, "test-agent")
	if err != nil {
		t.Fatalf("context: %v", err)
	}
	result, err := validateActivationCache(ctx)
	if err != nil {
		t.Fatalf("validate: %v", err)
	}
	if result.Valid || result.Reason != "input_hash_mismatch" {
		t.Fatalf("result = %+v, want input_hash_mismatch", result)
	}
	if len(result.Changed) == 0 || !strings.Contains(strings.Join(result.Changed, ","), "sshPublicKey") {
		t.Fatalf("expected missing input name in changed paths, got %v", result.Changed)
	}
}

func TestAgentsActivationValidateUnavailableInputReturnsInvalidJSON(t *testing.T) {
	dir := setupActivationCacheFixture(t)
	if err := runAgentsActivationRefreshCmd(io.Discard, dir, "test-agent", true); err != nil {
		t.Fatalf("refresh: %v", err)
	}
	credentialsPath := filepath.Join(dir, ".moltnet", "test-agent", "moltnet.json")
	if err := os.Remove(credentialsPath); err != nil {
		t.Fatal(err)
	}

	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "agents", "activation", "validate", "--identity", "test-agent", "--json")
	if err != nil {
		t.Fatalf("validate must report invalidation, not fail: %v", err)
	}
	var result activationValidationResult
	if err := json.Unmarshal([]byte(stdout), &result); err != nil {
		t.Fatalf("unmarshal result: %v\n%s", err, stdout)
	}
	if result.Valid || result.Reason != "input_unavailable" {
		t.Fatalf("result = %+v, want input_unavailable", result)
	}
}

func TestAgentsActivationValidateRejectsForgedCacheMetadata(t *testing.T) {
	dir := setupActivationCacheFixture(t)
	if err := runAgentsActivationRefreshCmd(io.Discard, dir, "test-agent", true); err != nil {
		t.Fatalf("refresh: %v", err)
	}
	cachePath := filepath.Join(dir, ".moltnet", "test-agent", "activation-cache.json")
	cache, err := readActivationCache(cachePath)
	if err != nil {
		t.Fatal(err)
	}
	cache.AuthorshipMode = "human"
	cache.AuthorshipConfigured = true
	cache.HumanGitIdentity = "Mallory <mallory@example.com>"
	cache.CredentialsPath = "/tmp/forged-moltnet.json"
	if err := writeActivationCache(cachePath, cache); err != nil {
		t.Fatal(err)
	}

	ctx, err := resolveActivationContext(dir, "test-agent")
	if err != nil {
		t.Fatal(err)
	}
	result, err := validateActivationCache(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if result.Valid || result.Reason != "cache_metadata_mismatch" {
		t.Fatalf("forged metadata was trusted: %+v", result)
	}
	if len(result.Changed) != 1 || !strings.HasSuffix(result.Changed[0], "activation-cache.json") {
		t.Fatalf("unexpected changed paths: %v", result.Changed)
	}
}

func TestAgentsActivationClear(t *testing.T) {
	dir := setupActivationCacheFixture(t)

	if err := runAgentsActivationRefreshCmd(io.Discard, dir, "test-agent", true); err != nil {
		t.Fatalf("refresh: %v", err)
	}
	cachePath := filepath.Join(dir, ".moltnet", "test-agent", "activation-cache.json")
	if _, err := os.Stat(cachePath); err != nil {
		t.Fatalf("cache missing before clear: %v", err)
	}
	if err := runAgentsActivationClearCmd(io.Discard, dir, "test-agent"); err != nil {
		t.Fatalf("clear: %v", err)
	}
	if _, err := os.Stat(cachePath); !os.IsNotExist(err) {
		t.Fatalf("cache still exists or unexpected stat error: %v", err)
	}
}

func TestAgentsActivationValidateOutsideGitRepository(t *testing.T) {
	setupActivationCacheFixture(t)
	if err := runAgentsActivationRefreshCmd(io.Discard, "test-agent", true); err != nil {
		t.Fatalf("refresh: %v", err)
	}
	ctx, err := resolveActivationContext("test-agent")
	if err != nil {
		t.Fatalf("context: %v", err)
	}
	result, err := validateActivationCache(ctx)
	if err != nil || !result.Valid {
		t.Fatalf("central cache must validate without a repository: result=%+v err=%v", result, err)
	}
}

func setupActivationCacheFixture(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("HOME", dir)
	agentDir := filepath.Join(dir, ".config", "moltnet", "identities", "test-agent")
	sshDir := filepath.Join(agentDir, "ssh")
	if err := os.MkdirAll(sshDir, 0o755); err != nil {
		t.Fatal(err)
	}
	// Keep existing fixture path assertions readable while the commands resolve
	// only through HOME/.config/moltnet. No production discovery follows this
	// compatibility symlink.
	if err := os.Symlink(filepath.Join(".config", "moltnet", "identities"), filepath.Join(dir, ".moltnet")); err != nil {
		t.Fatal(err)
	}
	if err := writeIdentitySelector("test-agent"); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(agentDir, "ssh", "id_ed25519.pub"), []byte("ssh-ed25519 AAAATEST test-agent\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(agentDir, "gitconfig"), []byte("[user]\n\tname = Test Agent\n\temail = test-agent@example.com\n\tsigningkey = ssh/id_ed25519.pub\n[gpg]\n\tformat = ssh\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	env := "MOLTNET_AGENT_NAME='test-agent'\nMOLTNET_FINGERPRINT='SHA256:testfingerprint'\nMOLTNET_DIARY_ID='00000000-0000-4000-8000-000000000001'\nMOLTNET_TEAM_ID='00000000-0000-4000-8000-000000000011'\nGIT_CONFIG_GLOBAL='gitconfig'\n"
	if err := os.WriteFile(filepath.Join(agentDir, "env"), []byte(env), 0o600); err != nil {
		t.Fatal(err)
	}
	creds := CredentialsFile{
		IdentityID: "test-agent",
		OAuth2: CredentialsOAuth2{
			ClientID:     "cid",
			ClientSecret: "secret",
		},
		Keys: CredentialsKeys{
			PublicKey:   "ed25519:public",
			PrivateKey:  "private",
			Fingerprint: "SHA256:testfingerprint",
		},
		Endpoints: CredentialsEndpoints{
			API: "https://api.example.test",
			MCP: "https://mcp.example.test",
		},
		SSH: &SSHSection{
			PublicKeyPath: filepath.Join(agentDir, "ssh", "id_ed25519.pub"),
		},
	}
	data, err := json.Marshal(creds)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(agentDir, "moltnet.json"), data, 0o600); err != nil {
		t.Fatal(err)
	}
	return dir
}

func rewriteActivationFixtureCredentials(t *testing.T, dir string, mutate func(*CredentialsFile)) {
	t.Helper()
	credentialsPath := filepath.Join(dir, ".config", "moltnet", "identities", "test-agent", "moltnet.json")
	creds, err := ReadConfigFrom(credentialsPath)
	if err != nil {
		t.Fatal(err)
	}
	mutate(creds)
	if _, err := WriteConfigTo(creds, credentialsPath); err != nil {
		t.Fatal(err)
	}
}

func TestAgentsActivationRecordsPerKindCredentialProviders(t *testing.T) {
	dir := setupActivationCacheFixture(t)
	rewriteActivationFixtureCredentials(t, dir, func(creds *CredentialsFile) {
		creds.OAuth2.ClientSecret = ""
		creds.OAuth2.ClientSecretRef = &SecretReference{Provider: "os-keyring", Key: OAuth2SecretKey("test-agent", "cid")}
		creds.Keys.PrivateKey = ""
		creds.Keys.PrivateKeyRef = &SecretReference{Provider: "file", Key: IdentitySeedKey("SHA256:testfingerprint")}
		creds.GitHub = &GitHubSection{AppID: "123", InstallationID: "456", PrivateKeyPath: filepath.Join(dir, "app.pem")}
		creds.AgentKeyRef = &SecretReference{Provider: "file", Key: AgentKeyKey("test-agent")}
	})

	var out bytes.Buffer
	if err := runAgentsActivationRefreshCmd(&out, dir, "test-agent", true); err != nil {
		t.Fatalf("refresh: %v", err)
	}
	var result activationValidationResult
	if err := json.Unmarshal(out.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	want := map[string]string{"oauth2": "os-keyring", "identitySeed": "file", "githubApp": "legacy-file", "agentKey": "file"}
	if !maps.Equal(result.CredentialProviders, want) {
		t.Fatalf("credentialProviders = %v, want %v", result.CredentialProviders, want)
	}
	if result.CredentialProvider != "os-keyring" || result.CredentialStatus != "configured" || !result.GitHubAppConfigured {
		t.Fatalf("legacy summary fields drifted: %+v", result)
	}
	if strings.Contains(out.String(), "identity/SHA256") || strings.Contains(out.String(), "agent-key/") {
		t.Fatal("activation output must not echo secret reference keys")
	}

	legacy := setupActivationCacheFixture(t)
	out.Reset()
	if err := runAgentsActivationRefreshCmd(&out, legacy, "test-agent", true); err != nil {
		t.Fatalf("refresh legacy: %v", err)
	}
	if err := json.Unmarshal(out.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	want = map[string]string{"oauth2": "legacy-plaintext", "identitySeed": "legacy-plaintext", "githubApp": "absent", "agentKey": "absent"}
	if !maps.Equal(result.CredentialProviders, want) {
		t.Fatalf("legacy credentialProviders = %v, want %v", result.CredentialProviders, want)
	}
}

func TestAgentsActivationValidateRejectsPreviousCacheVersion(t *testing.T) {
	dir := setupActivationCacheFixture(t)
	if err := runAgentsActivationRefreshCmd(io.Discard, dir, "test-agent", true); err != nil {
		t.Fatalf("refresh: %v", err)
	}
	cachePath := filepath.Join(dir, ".moltnet", "test-agent", "activation-cache.json")
	cache, err := readActivationCache(cachePath)
	if err != nil {
		t.Fatal(err)
	}
	cache.Version = 3
	cache.CredentialProviders = nil
	if err := writeActivationCache(cachePath, cache); err != nil {
		t.Fatal(err)
	}
	ctx, err := resolveActivationContext(dir, "test-agent")
	if err != nil {
		t.Fatal(err)
	}
	result, err := validateActivationCache(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if result.Valid || result.Reason != "version_mismatch" {
		t.Fatalf("v3 cache was accepted: %+v", result)
	}
}

func TestAgentsActivationValidateDetectsCredentialProviderChange(t *testing.T) {
	dir := setupActivationCacheFixture(t)
	if err := runAgentsActivationRefreshCmd(io.Discard, dir, "test-agent", true); err != nil {
		t.Fatalf("refresh: %v", err)
	}
	cachePath := filepath.Join(dir, ".moltnet", "test-agent", "activation-cache.json")
	cache, err := readActivationCache(cachePath)
	if err != nil {
		t.Fatal(err)
	}
	cache.CredentialProviders["identitySeed"] = "file"
	if err := writeActivationCache(cachePath, cache); err != nil {
		t.Fatal(err)
	}
	ctx, err := resolveActivationContext(dir, "test-agent")
	if err != nil {
		t.Fatal(err)
	}
	result, err := validateActivationCache(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if result.Valid || result.Reason != "cache_metadata_mismatch" {
		t.Fatalf("forged provider map was trusted: %+v", result)
	}
}

func TestAgentsActivationValidateReportsCredentialProviders(t *testing.T) {
	dir := setupActivationCacheFixture(t)
	rewriteActivationFixtureCredentials(t, dir, func(creds *CredentialsFile) {
		creds.AgentKeyRef = &SecretReference{Provider: "os-keyring", Key: AgentKeyKey("test-agent")}
	})
	if err := runAgentsActivationRefreshCmd(io.Discard, dir, "test-agent", true); err != nil {
		t.Fatalf("refresh: %v", err)
	}
	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "agents", "activation", "validate", "--identity", "test-agent", "--json")
	if err != nil {
		t.Fatalf("validate: %v", err)
	}
	var result activationValidationResult
	if err := json.Unmarshal([]byte(stdout), &result); err != nil {
		t.Fatalf("unmarshal: %v\n%s", err, stdout)
	}
	if !result.Valid {
		t.Fatalf("validate invalid: %+v", result)
	}
	want := map[string]string{"oauth2": "legacy-plaintext", "identitySeed": "legacy-plaintext", "githubApp": "absent", "agentKey": "os-keyring"}
	if !maps.Equal(result.CredentialProviders, want) {
		t.Fatalf("validate credentialProviders = %v, want %v", result.CredentialProviders, want)
	}
}
