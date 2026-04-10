package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestConfigExportEnvHelp(t *testing.T) {
	t.Parallel()
	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "config", "export-env", "--help")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(stdout, "--credentials") {
		t.Errorf("expected help to contain '--credentials', got: %s", stdout)
	}
	if !strings.Contains(stdout, "--output") {
		t.Errorf("expected help to contain '--output', got: %s", stdout)
	}
}

func TestConfigExportEnvToStdout(t *testing.T) {
	t.Parallel()
	tmpDir := t.TempDir()

	config := &CredentialsFile{
		IdentityID: "export-test-id",
		OAuth2: CredentialsOAuth2{
			ClientID:     "export-client-id",
			ClientSecret: "export-client-secret",
		},
		Keys: CredentialsKeys{
			PublicKey:   "ed25519:dGVzdC1wdWItLWZvci1tb2x0bmV0LWNsaS10ZXN0cyE=",
			PrivateKey:  "dGVzdC1zZWVkLWZvci1tb2x0bmV0LWNsaS10ZXN0cyE=",
			Fingerprint: "SHA256:exportfingerprint",
		},
		Endpoints: CredentialsEndpoints{
			API: "https://api.test.example.com",
			MCP: "https://mcp.test.example.com/mcp",
		},
		RegisteredAt: "2025-01-01T00:00:00Z",
	}
	credPath := filepath.Join(tmpDir, "moltnet.json")
	if _, err := WriteConfigTo(config, credPath); err != nil {
		t.Fatal(err)
	}

	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "config", "export-env", "--credentials", credPath)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Check that all required vars are present
	for _, expected := range []string{
		"MOLTNET_IDENTITY_ID=export-test-id",
		"MOLTNET_CLIENT_ID=export-client-id",
		"MOLTNET_CLIENT_SECRET=export-client-secret",
		"MOLTNET_PUBLIC_KEY=ed25519:",
		"MOLTNET_PRIVATE_KEY=",
		"MOLTNET_FINGERPRINT=SHA256:exportfingerprint",
		"MOLTNET_API_URL=https://api.test.example.com",
		"MOLTNET_REGISTERED_AT=2025-01-01T00:00:00Z",
	} {
		if !strings.Contains(stdout, expected) {
			t.Errorf("expected stdout to contain %q, got:\n%s", expected, stdout)
		}
	}
}

func TestConfigExportEnvToFile(t *testing.T) {
	t.Parallel()
	tmpDir := t.TempDir()

	config := &CredentialsFile{
		IdentityID: "file-export-id",
		OAuth2: CredentialsOAuth2{
			ClientID:     "file-client-id",
			ClientSecret: "file-client-secret",
		},
		Keys: CredentialsKeys{
			PublicKey:   "ed25519:dGVzdC1wdWItLWZvci1tb2x0bmV0LWNsaS10ZXN0cyE=",
			PrivateKey:  "dGVzdC1zZWVkLWZvci1tb2x0bmV0LWNsaS10ZXN0cyE=",
			Fingerprint: "SHA256:fingerprint",
		},
		Endpoints: CredentialsEndpoints{
			API: "https://api.example.com",
			MCP: "https://mcp.example.com/mcp",
		},
	}
	credPath := filepath.Join(tmpDir, "moltnet.json")
	if _, err := WriteConfigTo(config, credPath); err != nil {
		t.Fatal(err)
	}

	outPath := filepath.Join(tmpDir, ".env.moltnet")
	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "config", "export-env",
		"--credentials", credPath,
		"-o", outPath,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	data, err := os.ReadFile(outPath)
	if err != nil {
		t.Fatalf("failed to read output file: %v", err)
	}
	content := string(data)

	if !strings.Contains(content, "MOLTNET_IDENTITY_ID=file-export-id") {
		t.Errorf("output file missing IDENTITY_ID, got:\n%s", content)
	}
	if !strings.Contains(content, "MOLTNET_CLIENT_SECRET=file-client-secret") {
		t.Errorf("output file missing CLIENT_SECRET, got:\n%s", content)
	}

	// Verify file permissions
	info, err := os.Stat(outPath)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Errorf("expected file mode 0600, got %o", info.Mode().Perm())
	}
}

func TestConfigExportEnvWithGitHub(t *testing.T) {
	t.Parallel()
	tmpDir := t.TempDir()

	// Write a fake PEM file
	pemContent := "-----BEGIN RSA PRIVATE KEY-----\nfake-pem-content\n-----END RSA PRIVATE KEY-----"
	pemPath := filepath.Join(tmpDir, "app.pem")
	if err := os.WriteFile(pemPath, []byte(pemContent), 0o600); err != nil {
		t.Fatal(err)
	}

	config := &CredentialsFile{
		IdentityID: "gh-export-id",
		OAuth2: CredentialsOAuth2{
			ClientID:     "gh-client-id",
			ClientSecret: "gh-secret",
		},
		Keys: CredentialsKeys{
			PublicKey:   "ed25519:dGVzdC1wdWItLWZvci1tb2x0bmV0LWNsaS10ZXN0cyE=",
			PrivateKey:  "dGVzdC1zZWVkLWZvci1tb2x0bmV0LWNsaS10ZXN0cyE=",
			Fingerprint: "SHA256:fp",
		},
		Endpoints: CredentialsEndpoints{
			API: "https://api.example.com",
			MCP: "https://mcp.example.com/mcp",
		},
		GitHub: &GitHubSection{
			AppID:          "12345",
			AppSlug:        "my-app",
			InstallationID: "67890",
			PrivateKeyPath: pemPath,
		},
	}
	credPath := filepath.Join(tmpDir, "moltnet.json")
	if _, err := WriteConfigTo(config, credPath); err != nil {
		t.Fatal(err)
	}

	// Without --include-github-pem: should have app fields but not PEM
	root := NewRootCmd("test", "")
	stdout, _, err := executeCommand(root, "config", "export-env", "--credentials", credPath)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(stdout, "MOLTNET_GITHUB_APP_ID=12345") {
		t.Errorf("missing GITHUB_APP_ID, got:\n%s", stdout)
	}
	if !strings.Contains(stdout, "MOLTNET_GITHUB_APP_SLUG=my-app") {
		t.Errorf("missing GITHUB_APP_SLUG, got:\n%s", stdout)
	}
	if !strings.Contains(stdout, "MOLTNET_GITHUB_APP_INSTALLATION_ID=67890") {
		t.Errorf("missing GITHUB_APP_INSTALLATION_ID, got:\n%s", stdout)
	}
	if strings.Contains(stdout, "MOLTNET_GITHUB_APP_PRIVATE_KEY=") {
		t.Error("should not include PEM without --include-github-pem")
	}

	// With --include-github-pem: should include PEM content
	root2 := NewRootCmd("test", "")
	stdout2, _, err := executeCommand(root2, "config", "export-env",
		"--credentials", credPath,
		"--include-github-pem",
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(stdout2, "MOLTNET_GITHUB_APP_PRIVATE_KEY=") {
		t.Errorf("missing PEM with --include-github-pem, got:\n%s", stdout2)
	}
	if !strings.Contains(stdout2, "fake-pem-content") {
		t.Errorf("PEM content not included, got:\n%s", stdout2)
	}
}

func TestConfigExportEnvMissingConfig(t *testing.T) {
	t.Parallel()
	tmpDir := t.TempDir()

	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "config", "export-env",
		"--credentials", filepath.Join(tmpDir, "nonexistent.json"),
	)
	if err == nil {
		t.Fatal("expected error for missing config")
	}
}

func TestConfigExportEnvRoundTrip(t *testing.T) {
	t.Parallel()
	tmpDir := t.TempDir()

	// Create a config via export-env, then verify init-from-env can consume it
	config := &CredentialsFile{
		IdentityID: "roundtrip-id",
		OAuth2: CredentialsOAuth2{
			ClientID:     "rt-client",
			ClientSecret: "rt-secret",
		},
		Keys: CredentialsKeys{
			PublicKey:   testPublicKey,
			PrivateKey:  testPrivateKey,
			Fingerprint: "SHA256:rtfp",
		},
		Endpoints: CredentialsEndpoints{
			API: "https://api.rt.example.com",
			MCP: "https://mcp.rt.example.com/mcp",
		},
		RegisteredAt: "2025-06-01T12:00:00Z",
	}
	credPath := filepath.Join(tmpDir, "source", "moltnet.json")
	if _, err := WriteConfigTo(config, credPath); err != nil {
		t.Fatal(err)
	}

	// Step 1: export-env to a file
	envFile := filepath.Join(tmpDir, ".env.exported")
	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "config", "export-env",
		"--credentials", credPath,
		"-o", envFile,
	)
	if err != nil {
		t.Fatalf("export-env failed: %v", err)
	}

	// Step 2: init-from-env from that file into a new directory
	targetDir := filepath.Join(tmpDir, "target")
	root2 := NewRootCmd("test", "")
	_, _, err = executeCommand(root2, "config", "init-from-env",
		"--agent", "roundtrip-agent",
		"--dir", targetDir,
		"--skip-git",
		"--env-file", envFile,
	)
	if err != nil {
		t.Fatalf("init-from-env failed: %v", err)
	}

	// Step 3: read back the reconstructed config and verify
	reconstructed, err := ReadConfigFrom(
		filepath.Join(targetDir, ".moltnet", "roundtrip-agent", "moltnet.json"),
	)
	if err != nil {
		t.Fatalf("failed to read reconstructed config: %v", err)
	}

	if reconstructed.IdentityID != "roundtrip-id" {
		t.Errorf("identity_id mismatch: got %q", reconstructed.IdentityID)
	}
	if reconstructed.OAuth2.ClientID != "rt-client" {
		t.Errorf("client_id mismatch: got %q", reconstructed.OAuth2.ClientID)
	}
	if reconstructed.Keys.Fingerprint != "SHA256:rtfp" {
		t.Errorf("fingerprint mismatch: got %q", reconstructed.Keys.Fingerprint)
	}
	if reconstructed.Endpoints.API != "https://api.rt.example.com" {
		t.Errorf("API URL mismatch: got %q", reconstructed.Endpoints.API)
	}
}
