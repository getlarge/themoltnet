package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Valid 32-byte base64-encoded Ed25519 test keys.
const (
	testPublicKey  = "ed25519:dGVzdC1wdWItLWZvci1tb2x0bmV0LWNsaS10ZXN0cyE="
	testPrivateKey = "dGVzdC1zZWVkLWZvci1tb2x0bmV0LWNsaS10ZXN0cyE="
	altPublicKey   = "ed25519:ZmlsZS1wdWItLWZvci1tb2x0bmV0LWNsaS10ZXN0cyE="
	altPrivateKey  = "ZmlsZS1zZWVkLWZvci1tb2x0bmV0LWNsaS10ZXN0cyE="
)

// clearMoltnetEnv uses t.Setenv to blank every MOLTNET_* variable that might
// leak from the host process into a test, ensuring a clean env slate.
func clearMoltnetEnv(t *testing.T) {
	t.Helper()
	for _, key := range []string{
		"MOLTNET_IDENTITY_ID",
		"MOLTNET_CLIENT_ID",
		"MOLTNET_CLIENT_SECRET",
		"MOLTNET_PUBLIC_KEY",
		"MOLTNET_PRIVATE_KEY",
		"MOLTNET_FINGERPRINT",
		"MOLTNET_API_URL",
		"MOLTNET_REGISTERED_AT",
		"MOLTNET_GITHUB_APP_ID",
		"MOLTNET_GITHUB_APP_INSTALLATION_ID",
		"MOLTNET_GITHUB_APP_PRIVATE_KEY",
		"MOLTNET_GITHUB_APP_SLUG",
		"MOLTNET_AGENT_NAME",
		"MOLTNET_GIT_NAME",
		"MOLTNET_GIT_EMAIL",
	} {
		t.Setenv(key, "")
	}
}

func TestConfigInitFromEnvHelp(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "config", "init-from-env", "--help")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(stdout, "--agent") {
		t.Errorf("expected help to contain '--agent', got: %s", stdout)
	}
	if !strings.Contains(stdout, "MOLTNET_IDENTITY_ID") {
		t.Errorf("expected help to mention env vars, got: %s", stdout)
	}
	if !strings.Contains(stdout, "--env-file") {
		t.Errorf("expected help to contain '--env-file', got: %s", stdout)
	}
	if !strings.Contains(stdout, "--override") {
		t.Errorf("expected help to contain '--override', got: %s", stdout)
	}
}

func TestConfigInitFromEnvRequiresAgent(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "config", "init-from-env")
	if err == nil {
		t.Fatal("expected error when --agent is missing")
	}
}

func TestConfigInitFromEnvMissingEnvVars(t *testing.T) {
	clearMoltnetEnv(t) // prevent ambient vars from satisfying the check
	tmpDir := t.TempDir()
	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "config", "init-from-env", "--agent", "test-agent", "--dir", tmpDir)
	if err == nil {
		t.Fatal("expected error when env vars are missing")
	}
	if !strings.Contains(err.Error(), "MOLTNET_IDENTITY_ID") {
		t.Errorf("expected error to list missing vars, got: %v", err)
	}
}

func TestConfigInitFromEnvCreatesFiles(t *testing.T) {
	tmpDir := t.TempDir()

	t.Setenv("MOLTNET_IDENTITY_ID", "test-identity-123")
	t.Setenv("MOLTNET_CLIENT_ID", "test-client-id")
	t.Setenv("MOLTNET_CLIENT_SECRET", "test-client-secret")
	t.Setenv("MOLTNET_PUBLIC_KEY", testPublicKey)
	t.Setenv("MOLTNET_PRIVATE_KEY", testPrivateKey)
	t.Setenv("MOLTNET_FINGERPRINT", "SHA256:testfingerprint")
	t.Setenv("MOLTNET_API_URL", "https://api.test.example.com")

	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "config", "init-from-env", "--agent", "test-agent", "--dir", tmpDir, "--skip-git")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Check moltnet.json was created
	configPath := filepath.Join(tmpDir, ".moltnet", "test-agent", "moltnet.json")
	data, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("failed to read config: %v", err)
	}

	var config CredentialsFile
	if err := json.Unmarshal(data, &config); err != nil {
		t.Fatalf("failed to parse config: %v", err)
	}

	if config.IdentityID != "test-identity-123" {
		t.Errorf("expected identity_id 'test-identity-123', got %q", config.IdentityID)
	}
	if config.OAuth2.ClientID != "test-client-id" {
		t.Errorf("expected client_id 'test-client-id', got %q", config.OAuth2.ClientID)
	}
	if config.Endpoints.API != "https://api.test.example.com" {
		t.Errorf("expected API URL 'https://api.test.example.com', got %q", config.Endpoints.API)
	}
	if config.Endpoints.MCP != "https://mcp.test.example.com/mcp" {
		t.Errorf("expected MCP URL 'https://mcp.test.example.com/mcp', got %q", config.Endpoints.MCP)
	}

	// Check default-agent was created
	defaultAgent, err := os.ReadFile(filepath.Join(tmpDir, ".moltnet", "default-agent"))
	if err != nil {
		t.Fatalf("failed to read default-agent: %v", err)
	}
	if strings.TrimSpace(string(defaultAgent)) != "test-agent" {
		t.Errorf("expected default-agent 'test-agent', got %q", strings.TrimSpace(string(defaultAgent)))
	}

	// Check env file was created
	envPath := filepath.Join(tmpDir, ".moltnet", "test-agent", "env")
	envData, err := os.ReadFile(envPath)
	if err != nil {
		t.Fatalf("failed to read env file: %v", err)
	}
	envContent := string(envData)
	if !strings.Contains(envContent, "TEST_AGENT_CLIENT_ID='test-client-id'") {
		t.Errorf("env file missing CLIENT_ID, got: %s", envContent)
	}
}

func TestConfigInitFromEnvSkipsExisting(t *testing.T) {
	t.Parallel()
	tmpDir := t.TempDir()

	// Pre-create the config file
	agentDir := filepath.Join(tmpDir, ".moltnet", "existing-agent")
	if err := os.MkdirAll(agentDir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(agentDir, "moltnet.json"), []byte(`{}`), 0o600); err != nil {
		t.Fatal(err)
	}

	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "config", "init-from-env", "--agent", "existing-agent", "--dir", tmpDir)
	// Should succeed (skip) without requiring env vars
	if err != nil {
		t.Fatalf("expected no error for existing agent, got: %v", err)
	}
}

func TestConfigInitFromEnvWithEnvFile(t *testing.T) {
	clearMoltnetEnv(t) // prevent ambient vars from overriding file values
	tmpDir := t.TempDir()

	// Write a dotenv file with all required vars
	envContent := strings.Join([]string{
		`MOLTNET_IDENTITY_ID=file-identity-456`,
		`MOLTNET_CLIENT_ID=file-client-id`,
		`MOLTNET_CLIENT_SECRET=file-client-secret`,
		`MOLTNET_PUBLIC_KEY=` + testPublicKey,
		`MOLTNET_PRIVATE_KEY=` + testPrivateKey,
		`MOLTNET_FINGERPRINT=SHA256:filefingerprint`,
		`MOLTNET_API_URL=https://api.file.example.com`,
	}, "\n")
	envFilePath := filepath.Join(tmpDir, ".env.moltnet")
	if err := os.WriteFile(envFilePath, []byte(envContent), 0o600); err != nil {
		t.Fatal(err)
	}

	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "config", "init-from-env",
		"--agent", "file-agent",
		"--dir", tmpDir,
		"--skip-git",
		"--env-file", envFilePath,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Verify config was created from file values
	configPath := filepath.Join(tmpDir, ".moltnet", "file-agent", "moltnet.json")
	data, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("failed to read config: %v", err)
	}

	var config CredentialsFile
	if err := json.Unmarshal(data, &config); err != nil {
		t.Fatalf("failed to parse config: %v", err)
	}

	if config.IdentityID != "file-identity-456" {
		t.Errorf("expected identity_id 'file-identity-456', got %q", config.IdentityID)
	}
	if config.OAuth2.ClientID != "file-client-id" {
		t.Errorf("expected client_id 'file-client-id', got %q", config.OAuth2.ClientID)
	}
	if config.Endpoints.API != "https://api.file.example.com" {
		t.Errorf("expected API URL 'https://api.file.example.com', got %q", config.Endpoints.API)
	}
}

func TestConfigInitFromEnvFileDoesNotOverrideByDefault(t *testing.T) {
	tmpDir := t.TempDir()

	// Set a process env var that should win over the file
	t.Setenv("MOLTNET_IDENTITY_ID", "process-identity")
	t.Setenv("MOLTNET_CLIENT_ID", "process-client-id")
	t.Setenv("MOLTNET_CLIENT_SECRET", "process-client-secret")
	t.Setenv("MOLTNET_PUBLIC_KEY", testPublicKey)
	t.Setenv("MOLTNET_PRIVATE_KEY", testPrivateKey)
	t.Setenv("MOLTNET_FINGERPRINT", "SHA256:processfingerprint")

	// File has different values
	envContent := strings.Join([]string{
		`MOLTNET_IDENTITY_ID=file-identity`,
		`MOLTNET_CLIENT_ID=file-client-id`,
		`MOLTNET_CLIENT_SECRET=file-client-secret`,
		`MOLTNET_PUBLIC_KEY=` + altPublicKey,
		`MOLTNET_PRIVATE_KEY=` + altPrivateKey,
		`MOLTNET_FINGERPRINT=SHA256:filefingerprint`,
	}, "\n")
	envFilePath := filepath.Join(tmpDir, ".env.moltnet")
	if err := os.WriteFile(envFilePath, []byte(envContent), 0o600); err != nil {
		t.Fatal(err)
	}

	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "config", "init-from-env",
		"--agent", "no-override-agent",
		"--dir", tmpDir,
		"--skip-git",
		"--env-file", envFilePath,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	configPath := filepath.Join(tmpDir, ".moltnet", "no-override-agent", "moltnet.json")
	data, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("failed to read config: %v", err)
	}

	var config CredentialsFile
	if err := json.Unmarshal(data, &config); err != nil {
		t.Fatalf("failed to parse config: %v", err)
	}

	// Process env should win (godotenv.Load does not override)
	if config.IdentityID != "process-identity" {
		t.Errorf("expected process env to win, got identity_id %q", config.IdentityID)
	}
	if config.OAuth2.ClientID != "process-client-id" {
		t.Errorf("expected process env to win, got client_id %q", config.OAuth2.ClientID)
	}
}

func TestConfigInitFromEnvFileOverride(t *testing.T) {
	tmpDir := t.TempDir()

	// Set process env vars
	t.Setenv("MOLTNET_IDENTITY_ID", "process-identity")
	t.Setenv("MOLTNET_CLIENT_ID", "process-client-id")
	t.Setenv("MOLTNET_CLIENT_SECRET", "process-client-secret")
	t.Setenv("MOLTNET_PUBLIC_KEY", testPublicKey)
	t.Setenv("MOLTNET_PRIVATE_KEY", testPrivateKey)
	t.Setenv("MOLTNET_FINGERPRINT", "SHA256:processfingerprint")

	// File has different values that should win with --override
	envContent := strings.Join([]string{
		`MOLTNET_IDENTITY_ID=file-identity-wins`,
		`MOLTNET_CLIENT_ID=file-client-id-wins`,
		`MOLTNET_CLIENT_SECRET=file-client-secret`,
		`MOLTNET_PUBLIC_KEY=` + testPublicKey,
		`MOLTNET_PRIVATE_KEY=` + testPrivateKey,
		`MOLTNET_FINGERPRINT=SHA256:filefingerprint`,
	}, "\n")
	envFilePath := filepath.Join(tmpDir, ".env.moltnet")
	if err := os.WriteFile(envFilePath, []byte(envContent), 0o600); err != nil {
		t.Fatal(err)
	}

	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "config", "init-from-env",
		"--agent", "override-agent",
		"--dir", tmpDir,
		"--skip-git",
		"--env-file", envFilePath,
		"--override",
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	configPath := filepath.Join(tmpDir, ".moltnet", "override-agent", "moltnet.json")
	data, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("failed to read config: %v", err)
	}

	var config CredentialsFile
	if err := json.Unmarshal(data, &config); err != nil {
		t.Fatalf("failed to parse config: %v", err)
	}

	// File values should win with --override
	if config.IdentityID != "file-identity-wins" {
		t.Errorf("expected file env to win with --override, got identity_id %q", config.IdentityID)
	}
	if config.OAuth2.ClientID != "file-client-id-wins" {
		t.Errorf("expected file env to win with --override, got client_id %q", config.OAuth2.ClientID)
	}
}

func TestConfigInitFromEnvFileMissing(t *testing.T) {
	t.Parallel()
	tmpDir := t.TempDir()

	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "config", "init-from-env",
		"--agent", "test-agent",
		"--dir", tmpDir,
		"--env-file", filepath.Join(tmpDir, "nonexistent.env"),
	)
	if err == nil {
		t.Fatal("expected error for missing env file")
	}
	if !strings.Contains(err.Error(), "nonexistent.env") {
		t.Errorf("expected error to mention file path, got: %v", err)
	}
}

func TestConfigInitFromEnvFilePartialWithProcessEnv(t *testing.T) {
	clearMoltnetEnv(t) // prevent ambient vars from overriding file/test values
	tmpDir := t.TempDir()

	// File provides some vars
	envContent := strings.Join([]string{
		`MOLTNET_IDENTITY_ID=file-identity`,
		`MOLTNET_CLIENT_ID=file-client-id`,
		`MOLTNET_CLIENT_SECRET=file-client-secret`,
	}, "\n")
	envFilePath := filepath.Join(tmpDir, ".env.moltnet")
	if err := os.WriteFile(envFilePath, []byte(envContent), 0o600); err != nil {
		t.Fatal(err)
	}

	// Process provides the rest
	t.Setenv("MOLTNET_PUBLIC_KEY", testPublicKey)
	t.Setenv("MOLTNET_PRIVATE_KEY", testPrivateKey)
	t.Setenv("MOLTNET_FINGERPRINT", "SHA256:processfingerprint")

	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "config", "init-from-env",
		"--agent", "partial-agent",
		"--dir", tmpDir,
		"--skip-git",
		"--env-file", envFilePath,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	configPath := filepath.Join(tmpDir, ".moltnet", "partial-agent", "moltnet.json")
	data, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("failed to read config: %v", err)
	}

	var config CredentialsFile
	if err := json.Unmarshal(data, &config); err != nil {
		t.Fatalf("failed to parse config: %v", err)
	}

	// File vars
	if config.IdentityID != "file-identity" {
		t.Errorf("expected 'file-identity', got %q", config.IdentityID)
	}
	// Process vars
	if config.Keys.Fingerprint != "SHA256:processfingerprint" {
		t.Errorf("expected 'SHA256:processfingerprint', got %q", config.Keys.Fingerprint)
	}
}

func TestWriteAgentEnvFilePreservesUserSection(t *testing.T) {
	t.Parallel()
	tmpDir := t.TempDir()
	agentDir := filepath.Join(tmpDir, "test-agent")
	if err := os.MkdirAll(agentDir, 0o700); err != nil {
		t.Fatal(err)
	}

	// Pre-create an env file with user-section vars
	existingEnv := strings.Join([]string{
		"# Managed by moltnet config init-from-env — do not edit above the user section",
		"TEST_AGENT_CLIENT_ID='old-client-id'",
		"TEST_AGENT_CLIENT_SECRET='old-secret'",
		"GIT_CONFIG_GLOBAL='.moltnet/test-agent/gitconfig'",
		"",
		"# User section — add custom variables below",
		"MOLTNET_DIARY_ID='some-diary-uuid'",
		"MOLTNET_COMMIT_AUTHORSHIP='coauthor'",
		"MOLTNET_HUMAN_GIT_IDENTITY='Human Name <human@example.com>'",
		"",
	}, "\n")
	envPath := filepath.Join(agentDir, "env")
	if err := os.WriteFile(envPath, []byte(existingEnv), 0o600); err != nil {
		t.Fatal(err)
	}

	// Write with new managed values
	config := &CredentialsFile{
		OAuth2: CredentialsOAuth2{
			ClientID:     "new-client-id",
			ClientSecret: "new-secret",
		},
	}
	if err := writeAgentEnvFile(agentDir, "test-agent", config); err != nil {
		t.Fatalf("writeAgentEnvFile failed: %v", err)
	}

	// Read back and verify
	data, err := os.ReadFile(envPath)
	if err != nil {
		t.Fatalf("failed to read env file: %v", err)
	}
	content := string(data)

	// Managed vars should be updated
	if !strings.Contains(content, "TEST_AGENT_CLIENT_ID='new-client-id'") {
		t.Errorf("expected updated CLIENT_ID, got:\n%s", content)
	}
	// User vars should be preserved
	if !strings.Contains(content, "MOLTNET_DIARY_ID='some-diary-uuid'") {
		t.Errorf("expected preserved MOLTNET_DIARY_ID, got:\n%s", content)
	}
	if !strings.Contains(content, "MOLTNET_COMMIT_AUTHORSHIP='coauthor'") {
		t.Errorf("expected preserved MOLTNET_COMMIT_AUTHORSHIP, got:\n%s", content)
	}
	if !strings.Contains(content, "MOLTNET_HUMAN_GIT_IDENTITY='Human Name <human@example.com>'") {
		t.Errorf("expected preserved MOLTNET_HUMAN_GIT_IDENTITY, got:\n%s", content)
	}
}

func TestWriteAgentEnvFileNoExistingFile(t *testing.T) {
	t.Parallel()
	tmpDir := t.TempDir()
	agentDir := filepath.Join(tmpDir, "fresh-agent")
	if err := os.MkdirAll(agentDir, 0o700); err != nil {
		t.Fatal(err)
	}

	config := &CredentialsFile{
		OAuth2: CredentialsOAuth2{
			ClientID:     "client-id",
			ClientSecret: "secret",
		},
	}
	if err := writeAgentEnvFile(agentDir, "fresh-agent", config); err != nil {
		t.Fatalf("writeAgentEnvFile failed: %v", err)
	}

	data, err := os.ReadFile(filepath.Join(agentDir, "env"))
	if err != nil {
		t.Fatalf("failed to read env file: %v", err)
	}
	content := string(data)

	if !strings.Contains(content, "FRESH_AGENT_CLIENT_ID='client-id'") {
		t.Errorf("expected CLIENT_ID, got:\n%s", content)
	}
	if !strings.Contains(content, "# User section") {
		t.Errorf("expected user section marker, got:\n%s", content)
	}
}

func TestWriteAgentEnvFilePreservesNonManagedKeysOutsideUserSection(t *testing.T) {
	t.Parallel()
	tmpDir := t.TempDir()
	agentDir := filepath.Join(tmpDir, "test-agent")
	if err := os.MkdirAll(agentDir, 0o700); err != nil {
		t.Fatal(err)
	}

	// Env file with a non-managed var outside the user section (no user section marker)
	existingEnv := strings.Join([]string{
		"TEST_AGENT_CLIENT_ID='old'",
		"MOLTNET_DIARY_ID='diary-uuid'",
		"CUSTOM_VAR='keep-me'",
		"",
	}, "\n")
	if err := os.WriteFile(filepath.Join(agentDir, "env"), []byte(existingEnv), 0o600); err != nil {
		t.Fatal(err)
	}

	config := &CredentialsFile{
		OAuth2: CredentialsOAuth2{ClientID: "new", ClientSecret: "new-secret"},
	}
	if err := writeAgentEnvFile(agentDir, "test-agent", config); err != nil {
		t.Fatalf("writeAgentEnvFile failed: %v", err)
	}

	data, err := os.ReadFile(filepath.Join(agentDir, "env"))
	if err != nil {
		t.Fatal(err)
	}
	content := string(data)

	if !strings.Contains(content, "MOLTNET_DIARY_ID='diary-uuid'") {
		t.Errorf("expected preserved MOLTNET_DIARY_ID, got:\n%s", content)
	}
	if !strings.Contains(content, "CUSTOM_VAR='keep-me'") {
		t.Errorf("expected preserved CUSTOM_VAR, got:\n%s", content)
	}
}

func TestConfigInitFromEnvWithGitHubApp(t *testing.T) {
	tmpDir := t.TempDir()

	t.Setenv("MOLTNET_IDENTITY_ID", "gh-app-identity")
	t.Setenv("MOLTNET_CLIENT_ID", "gh-app-client-id")
	t.Setenv("MOLTNET_CLIENT_SECRET", "gh-app-client-secret")
	t.Setenv("MOLTNET_PUBLIC_KEY", testPublicKey)
	t.Setenv("MOLTNET_PRIVATE_KEY", testPrivateKey)
	t.Setenv("MOLTNET_FINGERPRINT", "SHA256:ghappfingerprint")
	t.Setenv("MOLTNET_GITHUB_APP_ID", "123456")
	t.Setenv("MOLTNET_GITHUB_APP_INSTALLATION_ID", "78901234")
	t.Setenv("MOLTNET_GITHUB_APP_PRIVATE_KEY", "fake-pem-content")
	t.Setenv("MOLTNET_GITHUB_APP_SLUG", "my-gh-app")

	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "config", "init-from-env",
		"--agent", "gh-app-agent",
		"--dir", tmpDir,
		"--skip-git",
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Check env file contains numeric AppID, not slug
	envPath := filepath.Join(tmpDir, ".moltnet", "gh-app-agent", "env")
	envData, err := os.ReadFile(envPath)
	if err != nil {
		t.Fatalf("failed to read env file: %v", err)
	}
	envContent := string(envData)

	if !strings.Contains(envContent, "GH_APP_AGENT_GITHUB_APP_ID='123456'") {
		t.Errorf("env file should contain numeric AppID '123456', got:\n%s", envContent)
	}
	// Verify the AppID line contains the numeric ID, not the slug
	for _, line := range strings.Split(envContent, "\n") {
		if strings.Contains(line, "GITHUB_APP_ID=") && !strings.Contains(line, "INSTALLATION") {
			if strings.Contains(line, "my-gh-app") {
				t.Errorf("GITHUB_APP_ID line contains slug instead of numeric ID: %s", line)
			}
			break
		}
	}
	if !strings.Contains(envContent, "GH_APP_AGENT_GITHUB_APP_INSTALLATION_ID='78901234'") {
		t.Errorf("env file missing installation ID, got:\n%s", envContent)
	}
}
