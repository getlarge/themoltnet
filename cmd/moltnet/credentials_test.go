package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestWriteReadCredentials(t *testing.T) {
	// Use a temp dir as HOME
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	result := &RegisterResult{
		KeyPair: &KeyPair{
			PublicKey:   "ed25519:dGVzdA==",
			PrivateKey:  "cHJpdmF0ZQ==",
			Fingerprint: "ABCD-1234-EF56-7890",
		},
		Response: &RegisterResponse{
			IdentityID:   "uuid-123",
			Fingerprint:  "ABCD-1234-EF56-7890",
			PublicKey:    "ed25519:dGVzdA==",
			ClientID:     "client-id",
			ClientSecret: "client-secret",
		},
		APIUrl: "https://api.themolt.net",
	}

	path, err := WriteCredentials(result)
	if err != nil {
		t.Fatalf("write: %v", err)
	}

	// WriteCredentials now delegates to WriteConfig, which writes moltnet.json
	expectedPath := filepath.Join(tmpDir, ".config", "moltnet", "moltnet.json")
	if path != expectedPath {
		t.Errorf("path: got %s, want %s", path, expectedPath)
	}

	// Check file permissions
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	if perm := info.Mode().Perm(); perm != 0o600 {
		t.Errorf("permissions: got %o, want 600", perm)
	}

	// Read back
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read file: %v", err)
	}
	var creds CredentialsFile
	if err := json.Unmarshal(data, &creds); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if creds.IdentityID != "uuid-123" {
		t.Errorf("identity_id: got %s", creds.IdentityID)
	}
	if creds.OAuth2.ClientID != "client-id" {
		t.Errorf("client_id: got %s", creds.OAuth2.ClientID)
	}
	if creds.Keys.PrivateKey != "cHJpdmF0ZQ==" {
		t.Errorf("private_key: got %s", creds.Keys.PrivateKey)
	}
	if creds.Endpoints.MCP != "https://mcp.themolt.net/mcp" {
		t.Errorf("mcp endpoint: got %s", creds.Endpoints.MCP)
	}

	// Test ReadCredentials (deprecated wrapper for ReadConfig)
	read, err := ReadCredentials()
	if err != nil {
		t.Fatalf("read credentials: %v", err)
	}
	if read == nil {
		t.Fatal("read returned nil")
	}
	if read.IdentityID != "uuid-123" {
		t.Errorf("read identity_id: got %s", read.IdentityID)
	}
}

func TestReadCredentials_Missing(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	creds, err := ReadCredentials()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if creds != nil {
		t.Error("expected nil for missing file")
	}
}

func TestReadConfig_MoltnetJson(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	dir := filepath.Join(tmpDir, ".config", "moltnet")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}

	config := CredentialsFile{
		IdentityID:   "uuid-from-moltnet",
		RegisteredAt: "2026-01-01T00:00:00Z",
		OAuth2:       CredentialsOAuth2{ClientID: "c1", ClientSecret: "s1"},
		Keys:         CredentialsKeys{PublicKey: "pk", PrivateKey: "sk", Fingerprint: "fp"},
		Endpoints:    CredentialsEndpoints{API: "https://api.test", MCP: "https://api.test/mcp"},
	}
	data, _ := json.Marshal(config)
	if err := os.WriteFile(filepath.Join(dir, "moltnet.json"), data, 0o600); err != nil {
		t.Fatal(err)
	}

	read, err := ReadConfig()
	if err != nil {
		t.Fatalf("ReadConfig: %v", err)
	}
	if read == nil {
		t.Fatal("expected non-nil")
	}
	if read.IdentityID != "uuid-from-moltnet" {
		t.Errorf("identity_id: got %s, want uuid-from-moltnet", read.IdentityID)
	}
}

func TestReadConfig_FallbackToCredentials(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	dir := filepath.Join(tmpDir, ".config", "moltnet")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}

	config := CredentialsFile{
		IdentityID:   "uuid-from-legacy",
		RegisteredAt: "2026-01-01T00:00:00Z",
		OAuth2:       CredentialsOAuth2{ClientID: "c1", ClientSecret: "s1"},
		Keys:         CredentialsKeys{PublicKey: "pk", PrivateKey: "sk", Fingerprint: "fp"},
		Endpoints:    CredentialsEndpoints{API: "https://api.test", MCP: "https://api.test/mcp"},
	}
	data, _ := json.Marshal(config)
	if err := os.WriteFile(filepath.Join(dir, "credentials.json"), data, 0o600); err != nil {
		t.Fatal(err)
	}

	read, err := ReadConfig()
	if err != nil {
		t.Fatalf("ReadConfig: %v", err)
	}
	if read == nil {
		t.Fatal("expected non-nil")
	}
	if read.IdentityID != "uuid-from-legacy" {
		t.Errorf("identity_id: got %s, want uuid-from-legacy", read.IdentityID)
	}
}

func TestReadConfig_PrefersMoltnetJson(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	dir := filepath.Join(tmpDir, ".config", "moltnet")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}

	legacy := CredentialsFile{
		IdentityID:   "uuid-old",
		RegisteredAt: "2026-01-01T00:00:00Z",
		OAuth2:       CredentialsOAuth2{ClientID: "c1", ClientSecret: "s1"},
		Keys:         CredentialsKeys{PublicKey: "pk", PrivateKey: "sk", Fingerprint: "fp"},
		Endpoints:    CredentialsEndpoints{API: "https://api.test", MCP: "https://api.test/mcp"},
	}
	modern := CredentialsFile{
		IdentityID:   "uuid-new",
		RegisteredAt: "2026-01-01T00:00:00Z",
		OAuth2:       CredentialsOAuth2{ClientID: "c2", ClientSecret: "s2"},
		Keys:         CredentialsKeys{PublicKey: "pk2", PrivateKey: "sk2", Fingerprint: "fp2"},
		Endpoints:    CredentialsEndpoints{API: "https://api.test", MCP: "https://api.test/mcp"},
	}

	legacyData, _ := json.Marshal(legacy)
	modernData, _ := json.Marshal(modern)
	os.WriteFile(filepath.Join(dir, "credentials.json"), legacyData, 0o600)
	os.WriteFile(filepath.Join(dir, "moltnet.json"), modernData, 0o600)

	read, err := ReadConfig()
	if err != nil {
		t.Fatalf("ReadConfig: %v", err)
	}
	if read == nil {
		t.Fatal("expected non-nil")
	}
	if read.IdentityID != "uuid-new" {
		t.Errorf("should prefer moltnet.json: got %s, want uuid-new", read.IdentityID)
	}
}

func TestWriteConfig(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	config := &CredentialsFile{
		IdentityID:   "uuid-write-test",
		RegisteredAt: "2026-01-01T00:00:00Z",
		OAuth2:       CredentialsOAuth2{ClientID: "c1", ClientSecret: "s1"},
		Keys:         CredentialsKeys{PublicKey: "pk", PrivateKey: "sk", Fingerprint: "fp"},
		Endpoints:    CredentialsEndpoints{API: "https://api.test", MCP: "https://api.test/mcp"},
	}

	path, err := WriteConfig(config)
	if err != nil {
		t.Fatalf("WriteConfig: %v", err)
	}

	expectedPath := filepath.Join(tmpDir, ".config", "moltnet", "moltnet.json")
	if path != expectedPath {
		t.Errorf("path: got %s, want %s", path, expectedPath)
	}

	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	if perm := info.Mode().Perm(); perm != 0o600 {
		t.Errorf("permissions: got %o, want 600", perm)
	}

	read, err := ReadConfigFrom(path)
	if err != nil {
		t.Fatalf("ReadConfigFrom: %v", err)
	}
	if read.IdentityID != "uuid-write-test" {
		t.Errorf("identity_id: got %s", read.IdentityID)
	}
}

func TestOptionalSections(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	config := &CredentialsFile{
		IdentityID:   "uuid-sections",
		RegisteredAt: "2026-01-01T00:00:00Z",
		OAuth2:       CredentialsOAuth2{ClientID: "c1", ClientSecret: "s1"},
		Keys:         CredentialsKeys{PublicKey: "pk", PrivateKey: "sk", Fingerprint: "fp"},
		Endpoints:    CredentialsEndpoints{API: "https://api.test", MCP: "https://api.test/mcp"},
		SSH: &SSHSection{
			PrivateKeyPath: "/path/to/id_ed25519",
			PublicKeyPath:  "/path/to/id_ed25519.pub",
		},
		Git: &GitSection{
			Name:       "agent-001",
			Email:      "agent-001@themolt.net",
			Signing:    true,
			ConfigPath: "/home/agent/.gitconfig",
		},
		GitHub: &GitHubSection{
			AppID:          "app-123",
			InstallationID: "install-456",
			PrivateKeyPath: "/path/to/key.pem",
		},
	}

	path, err := WriteConfig(config)
	if err != nil {
		t.Fatalf("WriteConfig: %v", err)
	}

	read, err := ReadConfigFrom(path)
	if err != nil {
		t.Fatalf("ReadConfigFrom: %v", err)
	}

	// SSH
	if read.SSH == nil {
		t.Fatal("SSH section is nil")
	}
	if read.SSH.PrivateKeyPath != "/path/to/id_ed25519" {
		t.Errorf("ssh private_key_path: got %s", read.SSH.PrivateKeyPath)
	}

	// Git
	if read.Git == nil {
		t.Fatal("Git section is nil")
	}
	if read.Git.Name != "agent-001" {
		t.Errorf("git name: got %s", read.Git.Name)
	}
	if !read.Git.Signing {
		t.Error("git signing should be true")
	}

	// GitHub
	if read.GitHub == nil {
		t.Fatal("GitHub section is nil")
	}
	if read.GitHub.AppID != "app-123" {
		t.Errorf("github app_id: got %s", read.GitHub.AppID)
	}
}

func TestOptionalSections_OmitEmpty(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	config := &CredentialsFile{
		IdentityID:   "uuid-no-sections",
		RegisteredAt: "2026-01-01T00:00:00Z",
		OAuth2:       CredentialsOAuth2{ClientID: "c1", ClientSecret: "s1"},
		Keys:         CredentialsKeys{PublicKey: "pk", PrivateKey: "sk", Fingerprint: "fp"},
		Endpoints:    CredentialsEndpoints{API: "https://api.test", MCP: "https://api.test/mcp"},
	}

	path, err := WriteConfig(config)
	if err != nil {
		t.Fatalf("WriteConfig: %v", err)
	}

	// Verify optional sections are omitted from JSON
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var raw map[string]interface{}
	json.Unmarshal(data, &raw)

	if _, exists := raw["ssh"]; exists {
		t.Error("ssh should be omitted when nil")
	}
	if _, exists := raw["git"]; exists {
		t.Error("git should be omitted when nil")
	}
	if _, exists := raw["github"]; exists {
		t.Error("github should be omitted when nil")
	}
}
