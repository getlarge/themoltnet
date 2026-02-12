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

	expectedPath := filepath.Join(tmpDir, ".config", "moltnet", "credentials.json")
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
	if creds.Endpoints.MCP != "https://api.themolt.net/mcp" {
		t.Errorf("mcp endpoint: got %s", creds.Endpoints.MCP)
	}

	// Test ReadCredentials
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
