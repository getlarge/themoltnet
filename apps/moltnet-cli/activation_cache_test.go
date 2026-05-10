package main

import (
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAgentsActivationValidateMissingCache(t *testing.T) {
	t.Parallel()
	dir := setupActivationCacheFixture(t)

	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "agents", "activation", "validate", "--agent", "test-agent", "--dir", dir, "--json")
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
}

func TestAgentsActivationValidateCorruptedCache(t *testing.T) {
	t.Parallel()
	dir := setupActivationCacheFixture(t)
	cachePath := filepath.Join(dir, ".moltnet", "test-agent", "activation-cache.json")
	if err := os.WriteFile(cachePath, []byte("{not valid json"), 0o600); err != nil {
		t.Fatal(err)
	}

	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "agents", "activation", "validate", "--agent", "test-agent", "--dir", dir, "--json")
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
	t.Parallel()
	dir := setupActivationCacheFixture(t)

	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "agents", "activation", "refresh", "--agent", "test-agent", "--dir", dir, "--json")
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
	var refreshPayload map[string]any
	if err := json.Unmarshal([]byte(stdout), &refreshPayload); err != nil {
		t.Fatalf("unmarshal refresh payload: %v\n%s", err, stdout)
	}
	if _, ok := refreshPayload["transport"]; ok {
		t.Fatal("refresh result must not include session-local transport")
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
	stdout, _, err = executeCommand(validateRoot, "agents", "activation", "validate", "--agent", "test-agent", "--dir", dir, "--json")
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

func TestAgentsActivationRefreshRebasesPortedAbsolutePaths(t *testing.T) {
	t.Parallel()
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
	stdout, _, err := executeCommand(root, "agents", "activation", "refresh", "--agent", "test-agent", "--dir", dir, "--json")
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
	if result.GitConfigGlobal != ".moltnet/test-agent/gitconfig" {
		t.Fatalf("gitConfigGlobal = %q", result.GitConfigGlobal)
	}

	cache, err := readActivationCache(filepath.Join(agentDir, "activation-cache.json"))
	if err != nil {
		t.Fatalf("read cache: %v", err)
	}
	if cache.Inputs["gitconfig"].Path != ".moltnet/test-agent/gitconfig" {
		t.Fatalf("gitconfig input path = %q", cache.Inputs["gitconfig"].Path)
	}
	if cache.Inputs["sshPublicKey"].Path != ".moltnet/test-agent/ssh/id_ed25519.pub" {
		t.Fatalf("ssh public key input path = %q", cache.Inputs["sshPublicKey"].Path)
	}
}

func TestAgentsActivationValidateHashMismatch(t *testing.T) {
	t.Parallel()
	dir := setupActivationCacheFixture(t)

	if err := runAgentsActivationRefreshCmd(io.Discard, dir, "test-agent", true); err != nil {
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
	if len(result.Changed) == 0 || !strings.Contains(strings.Join(result.Changed, ","), ".moltnet/test-agent/env") {
		t.Fatalf("expected env in changed paths, got %v", result.Changed)
	}
}

func TestAgentsActivationValidateRepoMismatch(t *testing.T) {
	t.Parallel()
	dir := setupActivationCacheFixture(t)

	if err := runAgentsActivationRefreshCmd(io.Discard, dir, "test-agent", true); err != nil {
		t.Fatalf("refresh: %v", err)
	}
	cachePath := filepath.Join(dir, ".moltnet", "test-agent", "activation-cache.json")
	cache, err := readActivationCache(cachePath)
	if err != nil {
		t.Fatalf("read cache: %v", err)
	}
	cache.RepoRoot = filepath.Join(dir, "other")
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
	if result.Valid || result.Reason != "repo_mismatch" {
		t.Fatalf("result = %+v, want repo_mismatch", result)
	}
}

func TestAgentsActivationValidateMissingRequiredInput(t *testing.T) {
	t.Parallel()
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

func TestAgentsActivationClear(t *testing.T) {
	t.Parallel()
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

func setupActivationCacheFixture(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	agentDir := filepath.Join(dir, ".moltnet", "test-agent")
	sshDir := filepath.Join(agentDir, "ssh")
	if err := os.MkdirAll(sshDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, ".moltnet", "default-agent"), []byte("test-agent\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(agentDir, "ssh", "id_ed25519.pub"), []byte("ssh-ed25519 AAAATEST test-agent\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(agentDir, "gitconfig"), []byte("[user]\n\tname = Test Agent\n\temail = test-agent@example.com\n\tsigningkey = .moltnet/test-agent/ssh/id_ed25519.pub\n[gpg]\n\tformat = ssh\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	env := "MOLTNET_AGENT_NAME='test-agent'\nMOLTNET_FINGERPRINT='SHA256:testfingerprint'\nMOLTNET_DIARY_ID='00000000-0000-4000-8000-000000000001'\nMOLTNET_TEAM_ID='00000000-0000-4000-8000-000000000011'\nGIT_CONFIG_GLOBAL='.moltnet/test-agent/gitconfig'\n"
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
