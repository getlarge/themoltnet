package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestLoadAndValidate_ValidConfig(t *testing.T) {
	tmpDir := t.TempDir()

	creds := CredentialsFile{
		IdentityID: "test-agent-12345678",
		Keys: CredentialsKeys{
			PublicKey:   "ed25519:O2onvM62pC1io6jQKm8Nc2UyFXcd4kOmOsBIoYtZ2ik=",
			PrivateKey:  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
			Fingerprint: "TEST-TEST-TEST-TEST",
		},
		Endpoints: CredentialsEndpoints{
			API: "https://api.themolt.net",
			MCP: "https://api.themolt.net/mcp",
		},
	}
	writeTestConfig(t, tmpDir, "moltnet.json", creds)

	_, _, issues, err := loadAndValidate(filepath.Join(tmpDir, "moltnet.json"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(issues) != 0 {
		t.Errorf("expected 0 issues, got %d: %v", len(issues), issues)
	}
}

func TestLoadAndValidate_MissingFields(t *testing.T) {
	tmpDir := t.TempDir()

	creds := CredentialsFile{} // all empty
	writeTestConfig(t, tmpDir, "moltnet.json", creds)

	_, _, issues, err := loadAndValidate(filepath.Join(tmpDir, "moltnet.json"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	fields := map[string]bool{}
	for _, iss := range issues {
		fields[iss.Field] = true
	}

	for _, required := range []string{"identity_id", "keys.public_key", "keys.private_key", "endpoints.api"} {
		if !fields[required] {
			t.Errorf("expected warning for %s, not found in issues", required)
		}
	}
}

func TestLoadAndValidate_FixesMissingMCP(t *testing.T) {
	tmpDir := t.TempDir()

	creds := CredentialsFile{
		IdentityID: "test",
		Keys: CredentialsKeys{
			PublicKey:  "ed25519:abc=",
			PrivateKey: "abc=",
		},
		Endpoints: CredentialsEndpoints{
			API: "https://api.themolt.net",
			// MCP intentionally missing
		},
	}
	writeTestConfig(t, tmpDir, "moltnet.json", creds)

	_, updated, issues, err := loadAndValidate(filepath.Join(tmpDir, "moltnet.json"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	var fixedMCP bool
	for _, iss := range issues {
		if iss.Field == "endpoints.mcp" && iss.Action == "fixed" {
			fixedMCP = true
		}
	}
	if !fixedMCP {
		t.Error("expected 'fixed' issue for endpoints.mcp")
	}
	if updated.Endpoints.MCP != "https://api.themolt.net/mcp" {
		t.Errorf("MCP endpoint = %q, want %q", updated.Endpoints.MCP, "https://api.themolt.net/mcp")
	}
}

func TestLoadAndValidate_StaleSSHPaths(t *testing.T) {
	tmpDir := t.TempDir()

	creds := CredentialsFile{
		IdentityID: "test",
		Keys: CredentialsKeys{
			PublicKey:  "ed25519:abc=",
			PrivateKey: "abc=",
		},
		Endpoints: CredentialsEndpoints{
			API: "https://api.themolt.net",
			MCP: "https://api.themolt.net/mcp",
		},
		SSH: &SSHSection{
			PrivateKeyPath: "/nonexistent/path/id_ed25519",
			PublicKeyPath:  "/nonexistent/path/id_ed25519.pub",
		},
	}
	writeTestConfig(t, tmpDir, "moltnet.json", creds)

	_, _, issues, err := loadAndValidate(filepath.Join(tmpDir, "moltnet.json"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	staleCount := 0
	for _, iss := range issues {
		if iss.Field == "ssh.private_key_path" || iss.Field == "ssh.public_key_path" {
			staleCount++
		}
	}
	if staleCount != 2 {
		t.Errorf("expected 2 stale SSH path warnings, got %d", staleCount)
	}
}

func TestLoadAndValidate_LegacyMigration(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	configDir := filepath.Join(tmpDir, ".config", "moltnet")
	if err := os.MkdirAll(configDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	creds := CredentialsFile{
		IdentityID: "legacy-agent",
		Keys: CredentialsKeys{
			PublicKey:  "ed25519:abc=",
			PrivateKey: "abc=",
		},
		Endpoints: CredentialsEndpoints{
			API: "https://api.themolt.net",
			MCP: "https://api.themolt.net/mcp",
		},
	}
	writeTestConfig(t, configDir, "credentials.json", creds)

	// No --credentials flag — should discover legacy file
	_, _, issues, err := loadAndValidate("")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	var hasMigrate bool
	for _, iss := range issues {
		if iss.Action == "migrate" {
			hasMigrate = true
		}
	}
	if !hasMigrate {
		t.Error("expected migrate issue for credentials.json")
	}
}

func TestRunConfigRepair_DryRun(t *testing.T) {
	tmpDir := t.TempDir()

	creds := CredentialsFile{
		IdentityID: "test",
		Keys: CredentialsKeys{
			PublicKey:  "ed25519:abc=",
			PrivateKey: "abc=",
		},
		Endpoints: CredentialsEndpoints{
			API: "https://api.themolt.net",
			// MCP missing — fixable
		},
	}
	credPath := filepath.Join(tmpDir, "moltnet.json")
	writeTestConfig(t, tmpDir, "moltnet.json", creds)

	err := runConfigRepair([]string{"--credentials", credPath, "--dry-run"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Verify file was NOT modified
	updated, err := ReadConfigFrom(credPath)
	if err != nil {
		t.Fatalf("read config: %v", err)
	}
	if updated.Endpoints.MCP != "" {
		t.Error("dry-run should not have modified the config")
	}
}

func TestRunConfigRepair_AppliesFixes(t *testing.T) {
	tmpDir := t.TempDir()

	creds := CredentialsFile{
		IdentityID: "test",
		Keys: CredentialsKeys{
			PublicKey:  "ed25519:abc=",
			PrivateKey: "abc=",
		},
		Endpoints: CredentialsEndpoints{
			API: "https://api.themolt.net",
		},
	}
	credPath := filepath.Join(tmpDir, "moltnet.json")
	writeTestConfig(t, tmpDir, "moltnet.json", creds)

	err := runConfigRepair([]string{"--credentials", credPath})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	updated, err := ReadConfigFrom(credPath)
	if err != nil {
		t.Fatalf("read config: %v", err)
	}
	if updated.Endpoints.MCP != "https://api.themolt.net/mcp" {
		t.Errorf("MCP endpoint = %q, want %q", updated.Endpoints.MCP, "https://api.themolt.net/mcp")
	}
}

func writeTestConfig(t *testing.T, dir, filename string, creds CredentialsFile) {
	t.Helper()
	data, err := json.Marshal(creds)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, filename), data, 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}
}
