package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRunGitSetup(t *testing.T) {
	// Arrange: create temp dir structure
	tmpDir := t.TempDir()

	// Override HOME so GetConfigDir() returns tmpDir/.config/moltnet
	t.Setenv("HOME", tmpDir)

	configDir := filepath.Join(tmpDir, ".config", "moltnet")
	if err := os.MkdirAll(configDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	// Write SSH public key file
	sshDir := filepath.Join(tmpDir, "ssh")
	if err := os.MkdirAll(sshDir, 0o700); err != nil {
		t.Fatalf("create ssh dir: %v", err)
	}
	pubKeyPath := filepath.Join(sshDir, "id_ed25519.pub")
	pubKeyContent := "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDtqJ7zOtqQtYqOo0CpvDXNlMhV3HeJDpjrASKGLWdop"
	if err := os.WriteFile(pubKeyPath, []byte(pubKeyContent+"\n"), 0o644); err != nil {
		t.Fatalf("write pub key: %v", err)
	}

	// Write credentials file with SSH section
	credPath := filepath.Join(tmpDir, "moltnet.json")
	creds := CredentialsFile{
		IdentityID: "test-agent-12345678",
		Keys: CredentialsKeys{
			PublicKey:   "ed25519:O2onvM62pC1io6jQKm8Nc2UyFXcd4kOmOsBIoYtZ2ik=",
			PrivateKey:  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
			Fingerprint: "TEST-TEST-TEST-TEST",
		},
		SSH: &SSHSection{
			PrivateKeyPath: filepath.Join(sshDir, "id_ed25519"),
			PublicKeyPath:  pubKeyPath,
		},
	}
	data, err := json.Marshal(creds)
	if err != nil {
		t.Fatalf("marshal creds: %v", err)
	}
	if err := os.WriteFile(credPath, data, 0o600); err != nil {
		t.Fatalf("write creds: %v", err)
	}

	// Act
	err = runGitSetup([]string{
		"--credentials", credPath,
	})
	if err != nil {
		t.Fatalf("runGitSetup: %v", err)
	}

	// Assert: gitconfig file exists with expected sections
	// When --credentials is provided, output is relative to the credentials file
	gitconfigPath := filepath.Join(tmpDir, "gitconfig")
	gitconfigData, err := os.ReadFile(gitconfigPath)
	if err != nil {
		t.Fatalf("read gitconfig: %v", err)
	}
	gitconfig := string(gitconfigData)

	for _, section := range []string{"[user]", "[gpg]", `[gpg "ssh"]`, "[commit]", "[tag]"} {
		if !strings.Contains(gitconfig, section) {
			t.Errorf("gitconfig missing section %s", section)
		}
	}

	// Verify default name/email in gitconfig
	if !strings.Contains(gitconfig, "name = moltnet-agent-test-age") {
		t.Errorf("gitconfig missing expected default name, got:\n%s", gitconfig)
	}
	if !strings.Contains(gitconfig, "email = test-agent-12345678@agents.themolt.net") {
		t.Errorf("gitconfig missing expected default email, got:\n%s", gitconfig)
	}

	// Assert: allowed_signers file exists with correct content
	allowedSignersPath := filepath.Join(tmpDir, "ssh", "allowed_signers")
	signersData, err := os.ReadFile(allowedSignersPath)
	if err != nil {
		t.Fatalf("read allowed_signers: %v", err)
	}
	signers := string(signersData)
	if !strings.Contains(signers, "test-agent-12345678@agents.themolt.net") {
		t.Errorf("allowed_signers missing email, got: %s", signers)
	}
	if !strings.Contains(signers, "ssh-ed25519") {
		t.Errorf("allowed_signers missing ssh-ed25519, got: %s", signers)
	}

	// Assert: git section updated in config (written back to original --credentials path)
	updatedCreds, err := ReadConfigFrom(credPath)
	if err != nil {
		t.Fatalf("read updated config: %v", err)
	}
	if updatedCreds == nil {
		t.Fatal("updated config is nil")
	}
	if updatedCreds.Git == nil {
		t.Fatal("git section not written to config")
	}
	if updatedCreds.Git.Name != "moltnet-agent-test-age" {
		t.Errorf("git name = %q, want %q", updatedCreds.Git.Name, "moltnet-agent-test-age")
	}
	if !updatedCreds.Git.Signing {
		t.Error("git signing should be true")
	}
	if updatedCreds.Git.ConfigPath != gitconfigPath {
		t.Errorf("git config path = %q, want %q", updatedCreds.Git.ConfigPath, gitconfigPath)
	}
}

func TestRunGitSetup_NoSSH(t *testing.T) {
	tmpDir := t.TempDir()

	// Write credentials file without SSH section
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

	err = runGitSetup([]string{
		"--credentials", credPath,
	})
	if err == nil {
		t.Fatal("expected error for missing SSH section, got nil")
	}
	if !strings.Contains(err.Error(), "SSH keys not exported") {
		t.Errorf("error should mention SSH keys, got: %v", err)
	}
}

func TestRunGitSetup_CustomNameEmail(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	configDir := filepath.Join(tmpDir, ".config", "moltnet")
	if err := os.MkdirAll(configDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	// Write SSH public key file
	sshDir := filepath.Join(tmpDir, "ssh")
	if err := os.MkdirAll(sshDir, 0o700); err != nil {
		t.Fatalf("create ssh dir: %v", err)
	}
	pubKeyPath := filepath.Join(sshDir, "id_ed25519.pub")
	pubKeyContent := "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDtqJ7zOtqQtYqOo0CpvDXNlMhV3HeJDpjrASKGLWdop"
	if err := os.WriteFile(pubKeyPath, []byte(pubKeyContent+"\n"), 0o644); err != nil {
		t.Fatalf("write pub key: %v", err)
	}

	credPath := filepath.Join(tmpDir, "moltnet.json")
	creds := CredentialsFile{
		IdentityID: "test-agent",
		Keys: CredentialsKeys{
			PublicKey:   "ed25519:O2onvM62pC1io6jQKm8Nc2UyFXcd4kOmOsBIoYtZ2ik=",
			PrivateKey:  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
			Fingerprint: "TEST-TEST-TEST-TEST",
		},
		SSH: &SSHSection{
			PrivateKeyPath: filepath.Join(sshDir, "id_ed25519"),
			PublicKeyPath:  pubKeyPath,
		},
	}
	data, err := json.Marshal(creds)
	if err != nil {
		t.Fatalf("marshal creds: %v", err)
	}
	if err := os.WriteFile(credPath, data, 0o600); err != nil {
		t.Fatalf("write creds: %v", err)
	}

	// Act with custom name and email
	err = runGitSetup([]string{
		"--credentials", credPath,
		"--name", "Custom Bot",
		"--email", "bot@example.com",
	})
	if err != nil {
		t.Fatalf("runGitSetup: %v", err)
	}

	// Assert: gitconfig uses custom values (relative to credentials file)
	gitconfigData, err := os.ReadFile(filepath.Join(tmpDir, "gitconfig"))
	if err != nil {
		t.Fatalf("read gitconfig: %v", err)
	}
	gitconfig := string(gitconfigData)

	if !strings.Contains(gitconfig, "name = Custom Bot") {
		t.Errorf("gitconfig missing custom name, got:\n%s", gitconfig)
	}
	if !strings.Contains(gitconfig, "email = bot@example.com") {
		t.Errorf("gitconfig missing custom email, got:\n%s", gitconfig)
	}

	// Assert: allowed_signers uses custom email
	signersData, err := os.ReadFile(filepath.Join(tmpDir, "ssh", "allowed_signers"))
	if err != nil {
		t.Fatalf("read allowed_signers: %v", err)
	}
	if !strings.Contains(string(signersData), "bot@example.com") {
		t.Errorf("allowed_signers should use custom email, got: %s", string(signersData))
	}

	// Assert: config has custom values (written back to original --credentials path)
	updatedCreds, err := ReadConfigFrom(credPath)
	if err != nil {
		t.Fatalf("read updated config: %v", err)
	}
	if updatedCreds.Git.Name != "Custom Bot" {
		t.Errorf("git name = %q, want %q", updatedCreds.Git.Name, "Custom Bot")
	}
	if updatedCreds.Git.Email != "bot@example.com" {
		t.Errorf("git email = %q, want %q", updatedCreds.Git.Email, "bot@example.com")
	}
}
