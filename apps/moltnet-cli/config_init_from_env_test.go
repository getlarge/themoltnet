package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

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
	t.Parallel()
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
	t.Parallel()
	tmpDir := t.TempDir()

	t.Setenv("MOLTNET_IDENTITY_ID", "test-identity-123")
	t.Setenv("MOLTNET_CLIENT_ID", "test-client-id")
	t.Setenv("MOLTNET_CLIENT_SECRET", "test-client-secret")
	t.Setenv("MOLTNET_PUBLIC_KEY", "ed25519:dGVzdHB1YmxpY2tleXRoYXRpczMyYnl0ZXMh")
	// 32 bytes base64-encoded seed
	t.Setenv("MOLTNET_PRIVATE_KEY", "dGVzdHByaXZhdGVrZXl0aGF0aXMzMmJ5")
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
