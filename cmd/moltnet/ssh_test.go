package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"golang.org/x/crypto/ssh"
)

type sshTestVector struct {
	Description      string `json:"description"`
	SeedBase64       string `json:"seed_base64"`
	PublicKeyMoltnet string `json:"public_key_moltnet"`
	PublicKeySSH     string `json:"public_key_ssh"`
}

type sshTestVectorsFile struct {
	Vectors []sshTestVector `json:"vectors"`
}

func loadSSHVectors(t *testing.T) []sshTestVector {
	t.Helper()
	_, filename, _, _ := runtime.Caller(0)
	dir := filepath.Dir(filename)
	path := filepath.Join(dir, "..", "..", "test-fixtures", "ssh-key-vectors.json")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("load ssh vectors: %v", err)
	}
	var f sshTestVectorsFile
	if err := json.Unmarshal(data, &f); err != nil {
		t.Fatalf("parse ssh vectors: %v", err)
	}
	return f.Vectors
}

func TestToSSHPublicKey(t *testing.T) {
	vectors := loadSSHVectors(t)
	for _, v := range vectors {
		t.Run(v.Description, func(t *testing.T) {
			got, err := ToSSHPublicKey(v.PublicKeyMoltnet)
			if err != nil {
				t.Fatalf("ToSSHPublicKey: %v", err)
			}
			if got != v.PublicKeySSH {
				t.Errorf("public key mismatch\n  got:  %s\n  want: %s", got, v.PublicKeySSH)
			}
		})
	}
}

func TestToSSHPrivateKey(t *testing.T) {
	vectors := loadSSHVectors(t)
	for _, v := range vectors {
		t.Run(v.Description, func(t *testing.T) {
			pemStr, err := ToSSHPrivateKey(v.SeedBase64)
			if err != nil {
				t.Fatalf("ToSSHPrivateKey: %v", err)
			}

			// Check PEM structure
			if !strings.HasPrefix(pemStr, "-----BEGIN OPENSSH PRIVATE KEY-----") {
				t.Error("PEM missing OPENSSH PRIVATE KEY header")
			}
			if !strings.HasSuffix(strings.TrimSpace(pemStr), "-----END OPENSSH PRIVATE KEY-----") {
				t.Error("PEM missing OPENSSH PRIVATE KEY footer")
			}

			// Parse back to verify structural validity
			parsed, err := ssh.ParseRawPrivateKey([]byte(pemStr))
			if err != nil {
				t.Fatalf("ssh.ParseRawPrivateKey failed: %v", err)
			}

			// Verify the parsed key produces the same public key
			signer, err := ssh.NewSignerFromKey(parsed)
			if err != nil {
				t.Fatalf("NewSignerFromKey: %v", err)
			}
			gotPub := strings.TrimSpace(string(ssh.MarshalAuthorizedKey(signer.PublicKey())))
			if gotPub != v.PublicKeySSH {
				t.Errorf("round-trip public key mismatch\n  got:  %s\n  want: %s", gotPub, v.PublicKeySSH)
			}
		})
	}
}

func TestToSSHPrivateKey_InvalidSeed(t *testing.T) {
	_, err := ToSSHPrivateKey("dG9vc2hvcnQ=") // "tooshort" base64
	if err == nil {
		t.Fatal("expected error for short seed, got nil")
	}
	if !strings.Contains(err.Error(), "32 bytes") {
		t.Errorf("error should mention 32 bytes, got: %v", err)
	}
}

func TestRunSSHKeyExport(t *testing.T) {
	// Create temp directories for credentials and output
	tmpDir := t.TempDir()
	outDir := filepath.Join(tmpDir, "ssh")
	credPath := filepath.Join(tmpDir, "credentials.json")

	// Write a minimal credentials file
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

	// Run the export
	err = runSSHKeyExport([]string{
		"--credentials", credPath,
		"--output-dir", outDir,
	})
	if err != nil {
		t.Fatalf("runSSHKeyExport: %v", err)
	}

	// Verify private key file
	privPath := filepath.Join(outDir, "id_ed25519")
	privData, err := os.ReadFile(privPath)
	if err != nil {
		t.Fatalf("read private key: %v", err)
	}
	if !strings.HasPrefix(string(privData), "-----BEGIN OPENSSH PRIVATE KEY-----") {
		t.Error("private key file missing PEM header")
	}
	privInfo, err := os.Stat(privPath)
	if err != nil {
		t.Fatalf("stat private key: %v", err)
	}
	if privInfo.Mode().Perm() != 0o600 {
		t.Errorf("private key permissions: got %o, want 600", privInfo.Mode().Perm())
	}

	// Verify public key file
	pubPath := filepath.Join(outDir, "id_ed25519.pub")
	pubData, err := os.ReadFile(pubPath)
	if err != nil {
		t.Fatalf("read public key: %v", err)
	}
	expectedPub := "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDtqJ7zOtqQtYqOo0CpvDXNlMhV3HeJDpjrASKGLWdop"
	if strings.TrimSpace(string(pubData)) != expectedPub {
		t.Errorf("public key mismatch\n  got:  %s\n  want: %s", strings.TrimSpace(string(pubData)), expectedPub)
	}
	pubInfo, err := os.Stat(pubPath)
	if err != nil {
		t.Fatalf("stat public key: %v", err)
	}
	if pubInfo.Mode().Perm() != 0o644 {
		t.Errorf("public key permissions: got %o, want 644", pubInfo.Mode().Perm())
	}
}
