package main

import (
	"bytes"
	"encoding/json"
	"io"
	"maps"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// fixtureIdentityID is the identity the stub server attributes the fixture's
// credential to. It has to be a UUID because that is what whoami returns.
const fixtureIdentityID = "00000000-0000-4000-8000-0000000000aa"

// startActivationIdentityServer stands in for the MoltNet API during
// activation. Refresh now confirms the local identity document against the
// server before pinning anything, so every activation test needs an endpoint
// that answers whoami — and the OAuth token exchange that authenticates it.
//
// The returned whoami agrees with the fixture credentials. Tests that need a
// disagreement override the fields through the returned pointers.
func startActivationIdentityServer(t *testing.T) (*httptest.Server, *activationIdentityResponse) {
	t.Helper()
	answer := &activationIdentityResponse{
		IdentityID:  fixtureIdentityID,
		SubjectType: "agent",
		PublicKey:   "ed25519:public",
		Fingerprint: "SHA256:testfingerprint",
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/oauth2/token":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"access_token": "test-token",
				"token_type":   "Bearer",
				"expires_in":   3600,
			})
		case "/agents/whoami":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"identityId":  answer.IdentityID,
				"subjectType": answer.SubjectType,
				"scopes":      []string{"agent:profile"},
				"publicKey":   answer.PublicKey,
				"fingerprint": answer.Fingerprint,
				"clientId":    "cid",
			})
		default:
			w.WriteHeader(http.StatusNotFound)
			_ = json.NewEncoder(w).Encode(map[string]any{"title": "not found"})
		}
	}))
	t.Cleanup(server.Close)
	return server, answer
}

// activationIdentityResponse is the record the stub server reports for the
// authenticating credential. Tests mutate it to make the server disagree with
// the local identity document.
type activationIdentityResponse struct {
	IdentityID  string
	SubjectType string
	PublicKey   string
	Fingerprint string
}

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

	ctx, err := resolveActivationContext("test-agent")
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

	if err := runAgentsActivationRefreshCmd(io.Discard, "test-agent", true); err != nil {
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

	ctx, err := resolveActivationContext("test-agent")
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

	if err := runAgentsActivationRefreshCmd(io.Discard, "test-agent", true); err != nil {
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

	ctx, err := resolveActivationContext("test-agent")
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
	if err := runAgentsActivationRefreshCmd(io.Discard, "test-agent", true); err != nil {
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
	if err := runAgentsActivationRefreshCmd(io.Discard, "test-agent", true); err != nil {
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

	ctx, err := resolveActivationContext("test-agent")
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

	if err := runAgentsActivationRefreshCmd(io.Discard, "test-agent", true); err != nil {
		t.Fatalf("refresh: %v", err)
	}
	cachePath := filepath.Join(dir, ".moltnet", "test-agent", "activation-cache.json")
	if _, err := os.Stat(cachePath); err != nil {
		t.Fatalf("cache missing before clear: %v", err)
	}
	if err := runAgentsActivationClearCmd(io.Discard, "test-agent"); err != nil {
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

// setupActivationCacheFixture is the common case: callers that do not need to
// reach the stub server.
func setupActivationCacheFixture(t *testing.T) string {
	dir, _, _ := setupActivationCacheFixtureWithIdentity(t)
	return dir
}

// setupActivationCacheFixtureWithIdentity also returns the stub server and the
// record it reports, for tests that need the server to disagree with the local
// document or to stop answering.
func setupActivationCacheFixtureWithIdentity(
	t *testing.T,
) (string, *httptest.Server, *activationIdentityResponse) {
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
	server, identityAnswer := startActivationIdentityServer(t)
	creds := CredentialsFile{
		IdentityID: fixtureIdentityID,
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
			API: server.URL,
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
	return dir, server, identityAnswer
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

// storeFixtureFileSecret makes a file-backed reference actually resolvable.
//
// Refresh authenticates in order to verify the identity against the server, so
// a credential reference that points at nothing now fails the whole refresh
// rather than merely being recorded as a provider name.
func storeFixtureFileSecret(t *testing.T, key, value string) {
	t.Helper()
	if os.Getenv(secretRootEnv) == "" {
		t.Setenv(secretRootEnv, t.TempDir())
		t.Setenv(secretRootWritableEnv, "1")
	}
	ref := SecretReference{Provider: "file", Key: key}
	if err := NewSecretProviderRegistry().Store(ref, value); err != nil {
		t.Fatalf("store %s: %v", key, err)
	}
}

func TestAgentsActivationRecordsPerKindCredentialProviders(t *testing.T) {
	dir := setupActivationCacheFixture(t)
	// Refresh authenticates with the agent key in preference to OAuth2, so that
	// is the reference that has to resolve. The OAuth2 secret stays keyring-
	// backed and is only recorded, which keeps os-keyring covered as a provider
	// name without needing a keyring on CI.
	storeFixtureFileSecret(t, AgentKeyKey(fixtureIdentityID), "fixture-agent-key")
	rewriteActivationFixtureCredentials(t, dir, func(creds *CredentialsFile) {
		creds.OAuth2.ClientSecret = ""
		creds.OAuth2.ClientSecretRef = &SecretReference{Provider: "os-keyring", Key: OAuth2SecretKey(fixtureIdentityID, "cid")}
		creds.Keys.PrivateKey = ""
		creds.Keys.PrivateKeyRef = &SecretReference{Provider: "file", Key: IdentitySeedKey("SHA256:testfingerprint")}
		creds.GitHub = &GitHubSection{AppID: "123", InstallationID: "456", PrivateKeyPath: filepath.Join(dir, "app.pem")}
		creds.AgentKeyRef = &SecretReference{Provider: "file", Key: AgentKeyKey(fixtureIdentityID)}
	})

	var out bytes.Buffer
	if err := runAgentsActivationRefreshCmd(&out, "test-agent", true); err != nil {
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

	setupActivationCacheFixture(t)
	out.Reset()
	if err := runAgentsActivationRefreshCmd(&out, "test-agent", true); err != nil {
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
	if err := runAgentsActivationRefreshCmd(io.Discard, "test-agent", true); err != nil {
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
	ctx, err := resolveActivationContext("test-agent")
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
	if err := runAgentsActivationRefreshCmd(io.Discard, "test-agent", true); err != nil {
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
	ctx, err := resolveActivationContext("test-agent")
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
	// File-backed so refresh can authenticate with it without a keyring;
	// os-keyring recording stays covered by
	// TestAgentsActivationRecordsPerKindCredentialProviders.
	storeFixtureFileSecret(t, AgentKeyKey(fixtureIdentityID), "fixture-agent-key")
	rewriteActivationFixtureCredentials(t, dir, func(creds *CredentialsFile) {
		creds.AgentKeyRef = &SecretReference{Provider: "file", Key: AgentKeyKey(fixtureIdentityID)}
	})
	if err := runAgentsActivationRefreshCmd(io.Discard, "test-agent", true); err != nil {
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
	want := map[string]string{"oauth2": "legacy-plaintext", "identitySeed": "legacy-plaintext", "githubApp": "absent", "agentKey": "file"}
	if !maps.Equal(result.CredentialProviders, want) {
		t.Fatalf("validate credentialProviders = %v, want %v", result.CredentialProviders, want)
	}
}

func TestAgentsActivationValidateJSONWhenNoIdentityResolves(t *testing.T) {
	// Arrange: an empty store, so identity resolution fails outright.
	isolateIdentityEnv(t)
	t.Setenv("HOME", t.TempDir())
	var out bytes.Buffer

	// Act.
	err := runAgentsActivationValidateCmd(&out, "", true)

	// Assert: --json consumers parse stdout, so "not active" has to arrive as a
	// document rather than as an empty stream they cannot distinguish from a
	// crash. The command still fails, so the exit code stays non-zero.
	if err == nil {
		t.Fatal("expected an error when no identity resolves")
	}
	var result activationValidationResult
	if jsonErr := json.Unmarshal(out.Bytes(), &result); jsonErr != nil {
		t.Fatalf("stdout is not a JSON document: %v\n%s", jsonErr, out.String())
	}
	if result.Valid {
		t.Fatalf("valid = true, want false: %s", out.String())
	}
	if result.Reason == "" {
		t.Fatalf("reason is empty: %s", out.String())
	}
}

func TestAgentsActivationValidateWithoutJSONStaysQuietOnStdout(t *testing.T) {
	// Arrange: the text form must not gain a half-rendered result line; the
	// error message alone is the answer there.
	isolateIdentityEnv(t)
	t.Setenv("HOME", t.TempDir())
	var out bytes.Buffer

	// Act.
	err := runAgentsActivationValidateCmd(&out, "", false)

	// Assert.
	if err == nil {
		t.Fatal("expected an error when no identity resolves")
	}
	if out.Len() != 0 {
		t.Fatalf("stdout = %q, want empty", out.String())
	}
}

func TestAgentsActivationRefreshRejectsServerIdentityMismatch(t *testing.T) {
	// Arrange: the local document claims a fingerprint the server does not
	// attribute to this credential — the exact case a local-only check cannot
	// catch, because whoever edited the file is trusted by the filesystem.
	for _, tc := range []struct {
		name    string
		mutate  func(*activationIdentityResponse)
		wantMsg string
	}{
		{
			name:    "fingerprint",
			mutate:  func(a *activationIdentityResponse) { a.Fingerprint = "SHA256:someoneelse" },
			wantMsg: "local fingerprint does not match",
		},
		{
			name:    "public key",
			mutate:  func(a *activationIdentityResponse) { a.PublicKey = "ed25519:someoneelse" },
			wantMsg: "local public key does not match",
		},
		{
			name:    "identity id",
			mutate:  func(a *activationIdentityResponse) { a.IdentityID = "00000000-0000-4000-8000-0000000000bb" },
			wantMsg: "local identity_id does not match",
		},
		{
			name:    "human subject",
			mutate:  func(a *activationIdentityResponse) { a.SubjectType = "human" },
			wantMsg: "not as an agent",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, _, identity := setupActivationCacheFixtureWithIdentity(t)
			tc.mutate(identity)

			// Act.
			err := runAgentsActivationRefreshCmd(io.Discard, "test-agent", true)

			// Assert.
			if err == nil {
				t.Fatal("expected refresh to reject an identity the server does not confirm")
			}
			if !strings.Contains(err.Error(), tc.wantMsg) {
				t.Fatalf("error = %v, want it to mention %q", err, tc.wantMsg)
			}
		})
	}
}

func TestAgentsActivationRefreshPinsVerifiedIdentity(t *testing.T) {
	// Arrange.
	dir := setupActivationCacheFixture(t)

	// Act.
	if err := runAgentsActivationRefreshCmd(io.Discard, "test-agent", true); err != nil {
		t.Fatalf("refresh: %v", err)
	}

	// Assert: warm validation is offline by contract, so what the server
	// confirmed has to be recorded rather than re-fetched.
	data, err := os.ReadFile(filepath.Join(dir, ".moltnet", "test-agent", "activation-cache.json"))
	if err != nil {
		t.Fatalf("read cache: %v", err)
	}
	var cache activationCache
	if err := json.Unmarshal(data, &cache); err != nil {
		t.Fatalf("unmarshal cache: %v", err)
	}
	if cache.VerifiedIdentityID != fixtureIdentityID {
		t.Fatalf("verifiedIdentityId = %q, want %q", cache.VerifiedIdentityID, fixtureIdentityID)
	}
	if cache.VerifiedPublicKey != "ed25519:public" {
		t.Fatalf("verifiedPublicKey = %q", cache.VerifiedPublicKey)
	}
	if cache.IdentityVerifiedAt == "" {
		t.Fatal("identityVerifiedAt is empty")
	}
}

func TestAgentsActivationRefreshRejectsStaleEnvFingerprint(t *testing.T) {
	// Arrange: a stale MOLTNET_FINGERPRINT would previously be pinned into the
	// cache as though it had been checked.
	dir := setupActivationCacheFixture(t)
	envPath := filepath.Join(dir, ".moltnet", "test-agent", "env")
	body, err := os.ReadFile(envPath)
	if err != nil {
		t.Fatal(err)
	}
	stale := strings.Replace(string(body), "SHA256:testfingerprint", "SHA256:stalefingerprint", 1)
	if err := os.WriteFile(envPath, []byte(stale), 0o600); err != nil {
		t.Fatal(err)
	}

	// Act.
	err = runAgentsActivationRefreshCmd(io.Discard, "test-agent", true)

	// Assert.
	if err == nil {
		t.Fatal("expected a stale MOLTNET_FINGERPRINT to be rejected")
	}
	if !strings.Contains(err.Error(), "but the server reports") {
		t.Fatalf("error = %v", err)
	}
}

// TestAgentsActivationRefreshResolvesOSKeyringAgentKey covers the path the rest
// of the activation suite deliberately avoids.
//
// Refresh authenticates in order to verify the identity, and it prefers an
// agent_key_ref, so a keyring-backed agent key must be resolvable for
// activation to complete. The other tests keep that reference file-backed so
// they run without a credential store; this one exercises the real thing and is
// wired into the `test-native` target, which CI runs on Linux, macOS and
// Windows with a live keyring.
func TestAgentsActivationRefreshResolvesOSKeyringAgentKey(t *testing.T) {
	requireOSKeyringTestable(t)

	// Arrange.
	dir := setupActivationCacheFixture(t)
	provider := OSKeyringSecretProvider{}
	key := AgentKeyKey(fixtureIdentityID)
	if err := provider.Set(key, "fixture-agent-key"); err != nil {
		t.Fatalf("store agent key in the OS keyring: %v", err)
	}
	// The keyring is per-user and outlives the test's temporary HOME.
	t.Cleanup(func() { _ = provider.Delete(key) })
	rewriteActivationFixtureCredentials(t, dir, func(creds *CredentialsFile) {
		creds.AgentKeyRef = &SecretReference{Provider: osKeyringProviderName, Key: key}
	})

	// Act.
	var out bytes.Buffer
	if err := runAgentsActivationRefreshCmd(&out, "test-agent", true); err != nil {
		t.Fatalf("refresh with a keyring-backed agent key: %v", err)
	}

	// Assert.
	var result activationValidationResult
	if err := json.Unmarshal(out.Bytes(), &result); err != nil {
		t.Fatalf("unmarshal: %v\n%s", err, out.String())
	}
	if !result.Valid {
		t.Fatalf("refresh reported invalid: %+v", result)
	}
	if got := result.CredentialProviders["agentKey"]; got != osKeyringProviderName {
		t.Fatalf("agentKey provider = %q, want %q", got, osKeyringProviderName)
	}
}

func TestAgentsActivationRefreshReportsRejectedCredential(t *testing.T) {
	// Arrange: the server no longer recognises the credential, which is the
	// shape a revoked or rotated binding takes from the client's side.
	dir := setupActivationCacheFixture(t)
	rejecting := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/oauth2/token" {
			_ = json.NewEncoder(w).Encode(map[string]any{
				"access_token": "test-token", "token_type": "Bearer", "expires_in": 3600,
			})
			return
		}
		w.WriteHeader(http.StatusUnauthorized)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"title":  "Unauthorized",
			"status": 401,
			"detail": "credential is not active",
			"code":   "UNAUTHORIZED",
			"type":   "https://themolt.net/problems/unauthorized",
		})
	}))
	t.Cleanup(rejecting.Close)
	rewriteActivationFixtureCredentials(t, dir, func(creds *CredentialsFile) {
		creds.Endpoints.API = rejecting.URL
	})

	// Act.
	err := runAgentsActivationRefreshCmd(io.Discard, "test-agent", true)

	// Assert: reported as a rejected binding, not as an opaque failure, and
	// nothing is pinned from an unverified answer.
	if err == nil {
		t.Fatal("expected refresh to fail when the server rejects the credential")
	}
	if !strings.Contains(err.Error(), "rejected this credential") {
		t.Fatalf("error = %v", err)
	}
	if _, statErr := os.Stat(filepath.Join(dir, ".moltnet", "test-agent", "activation-cache.json")); statErr == nil {
		t.Fatal("an activation cache was written despite an unverified identity")
	}
}

func TestAgentsActivationValidateStaysOfflineAfterRefresh(t *testing.T) {
	// Arrange: refresh against a live server, then take the server away.
	dir, server, _ := setupActivationCacheFixtureWithIdentity(t)
	if err := runAgentsActivationRefreshCmd(io.Discard, "test-agent", true); err != nil {
		t.Fatalf("refresh: %v", err)
	}
	server.Close()

	// Act: warm validation is offline by contract. It must not need the server,
	// the keyring, or anything else that can be unavailable — an outage turning
	// a good cache into input_unavailable is exactly the regression this guards.
	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "agents", "activation", "validate", "--identity", "test-agent", "--json")

	// Assert.
	if err != nil {
		t.Fatalf("validate after the server went away: %v", err)
	}
	var result activationValidationResult
	if jsonErr := json.Unmarshal([]byte(stdout), &result); jsonErr != nil {
		t.Fatalf("unmarshal: %v\n%s", jsonErr, stdout)
	}
	if !result.Valid {
		t.Fatalf("validate went invalid with the server down: %+v", result)
	}
	_ = dir
}

func TestAgentsActivationValidateRejectsUnverifiedCache(t *testing.T) {
	// Arrange: a cache with the verification pins stripped, which is what a
	// hand-edited or pre-verification cache looks like.
	dir, _, _ := setupActivationCacheFixtureWithIdentity(t)
	if err := runAgentsActivationRefreshCmd(io.Discard, "test-agent", true); err != nil {
		t.Fatalf("refresh: %v", err)
	}
	cachePath := filepath.Join(dir, ".moltnet", "test-agent", "activation-cache.json")
	raw, err := os.ReadFile(cachePath)
	if err != nil {
		t.Fatal(err)
	}
	var cache map[string]any
	if err := json.Unmarshal(raw, &cache); err != nil {
		t.Fatal(err)
	}
	delete(cache, "verifiedIdentityId")
	patched, err := json.Marshal(cache)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(cachePath, patched, 0o600); err != nil {
		t.Fatal(err)
	}

	// Act.
	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "agents", "activation", "validate", "--identity", "test-agent", "--json")
	if err != nil {
		t.Fatalf("validate: %v", err)
	}

	// Assert.
	var result activationValidationResult
	if jsonErr := json.Unmarshal([]byte(stdout), &result); jsonErr != nil {
		t.Fatalf("unmarshal: %v\n%s", jsonErr, stdout)
	}
	if result.Valid || result.Reason != "identity_unverified" {
		t.Fatalf("result = %+v, want invalid with identity_unverified", result)
	}
}

func TestAgentsActivationValidateRejectsChangedAPIOrigin(t *testing.T) {
	// Arrange: the identity was confirmed against one origin; the document now
	// names another, so the verification no longer describes where this
	// credential would be sent.
	dir, _, _ := setupActivationCacheFixtureWithIdentity(t)
	if err := runAgentsActivationRefreshCmd(io.Discard, "test-agent", true); err != nil {
		t.Fatalf("refresh: %v", err)
	}
	rewriteActivationFixtureCredentials(t, dir, func(creds *CredentialsFile) {
		creds.Endpoints.API = "https://somewhere-else.example.test"
	})

	// Act.
	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "agents", "activation", "validate", "--identity", "test-agent", "--json")
	if err != nil {
		t.Fatalf("validate: %v", err)
	}

	// Assert.
	var result activationValidationResult
	if jsonErr := json.Unmarshal([]byte(stdout), &result); jsonErr != nil {
		t.Fatalf("unmarshal: %v\n%s", jsonErr, stdout)
	}
	if result.Valid {
		t.Fatalf("validate accepted a changed API origin: %+v", result)
	}
}
