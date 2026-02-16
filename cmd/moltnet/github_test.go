package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestGetInstallationToken_MissingKeyFile(t *testing.T) {
	_, err := getInstallationToken("12345", "/nonexistent/path/key.pem", "67890")
	if err == nil {
		t.Fatal("expected error for missing key file, got nil")
	}
	if !strings.Contains(err.Error(), "read GitHub App private key") {
		t.Errorf("error should mention reading private key, got: %v", err)
	}
}

func TestGitHubCredentialHelper_NoGitHub(t *testing.T) {
	tmpDir := t.TempDir()

	// Write credentials file without GitHub section
	credPath := filepath.Join(tmpDir, "moltnet.json")
	creds := CredentialsFile{
		IdentityID: "test-agent",
		Keys: CredentialsKeys{
			PublicKey:   "ed25519:O2onvM62pC1io6jQKm8Nc2UyFXcd4kOmOsBIoYtZ2ik=",
			PrivateKey:  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
			Fingerprint: "TEST-TEST-TEST-TEST",
		},
	}
	data, err := json.Marshal(creds)
	if err != nil {
		t.Fatalf("marshal creds: %v", err)
	}
	if err := os.WriteFile(credPath, data, 0o600); err != nil {
		t.Fatalf("write creds: %v", err)
	}

	err = runGitHubCredentialHelper([]string{
		"--credentials", credPath,
	})
	if err == nil {
		t.Fatal("expected error for missing GitHub section, got nil")
	}
	if !strings.Contains(err.Error(), "GitHub App not configured") {
		t.Errorf("error should mention GitHub App, got: %v", err)
	}
}
