package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLookupBotUser(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/users/testbot[bot]" {
			t.Errorf("unexpected path: %s", r.URL.Path)
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"id":999999,"login":"testbot[bot]","type":"Bot"}`)
	}))
	defer server.Close()

	old := githubAPIBaseURL
	githubAPIBaseURL = server.URL
	defer func() { githubAPIBaseURL = old }()

	id, name, err := lookupBotUser("testbot")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if id != 999999 {
		t.Errorf("bot user ID = %d, want 999999", id)
	}
	if name != "testbot" {
		t.Errorf("name = %q, want %q", name, "testbot")
	}
}

func TestRunGitHubSetup_NoGitHub(t *testing.T) {
	tmpDir := t.TempDir()

	credPath := filepath.Join(tmpDir, "moltnet.json")
	creds := CredentialsFile{
		IdentityID: "test-agent",
		Keys: CredentialsKeys{
			PublicKey:   "ed25519:O2onvM62pC1io6jQKm8Nc2UyFXcd4kOmOsBIoYtZ2ik=",
			PrivateKey:  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
			Fingerprint: "TEST-TEST-TEST-TEST",
		},
	}
	data, _ := json.Marshal(creds)
	os.WriteFile(credPath, data, 0o600)

	err := runGitHubSetup([]string{"--credentials", credPath, "--app-slug", "test"})
	if err == nil {
		t.Fatal("expected error for missing GitHub section")
	}
	if !strings.Contains(err.Error(), "GitHub App not configured") {
		t.Errorf("error = %v, want mention of GitHub App", err)
	}
}

func TestRunGitHubSetup_NoSlug(t *testing.T) {
	tmpDir := t.TempDir()

	credPath := filepath.Join(tmpDir, "moltnet.json")
	creds := CredentialsFile{
		IdentityID: "test-agent",
		Keys: CredentialsKeys{
			PublicKey:   "ed25519:O2onvM62pC1io6jQKm8Nc2UyFXcd4kOmOsBIoYtZ2ik=",
			PrivateKey:  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
			Fingerprint: "TEST-TEST-TEST-TEST",
		},
		GitHub: &GitHubSection{
			AppID:          "12345",
			InstallationID: "67890",
			PrivateKeyPath: "/tmp/fake.pem",
		},
	}
	data, _ := json.Marshal(creds)
	os.WriteFile(credPath, data, 0o600)

	err := runGitHubSetup([]string{"--credentials", credPath})
	if err == nil {
		t.Fatal("expected error for missing slug")
	}
	if !strings.Contains(err.Error(), "app slug required") {
		t.Errorf("error = %v, want mention of app slug", err)
	}
}

func TestRunGitHubSetup_FullFlow(t *testing.T) {
	// Mock GitHub API for bot user lookup
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"id":261968324,"login":"mybot[bot]","type":"Bot"}`)
	}))
	defer server.Close()

	old := githubAPIBaseURL
	githubAPIBaseURL = server.URL
	defer func() { githubAPIBaseURL = old }()

	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	// Write SSH public key file
	sshDir := filepath.Join(tmpDir, "ssh")
	os.MkdirAll(sshDir, 0o700)
	pubKeyPath := filepath.Join(sshDir, "id_ed25519.pub")
	os.WriteFile(pubKeyPath, []byte("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDtqJ7zOtqQtYqOo0CpvDXNlMhV3HeJDpjrASKGLWdop\n"), 0o644)

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
		GitHub: &GitHubSection{
			AppID:          "2878569",
			InstallationID: "12345",
			PrivateKeyPath: "/tmp/fake.pem",
		},
	}
	data, _ := json.Marshal(creds)
	os.WriteFile(credPath, data, 0o600)

	err := runGitHubSetup([]string{
		"--credentials", credPath,
		"--app-slug", "mybot",
		"--name", "MyBot",
	})
	if err != nil {
		t.Fatalf("runGitHubSetup: %v", err)
	}

	// Verify gitconfig has correct bot email
	gitconfigData, err := os.ReadFile(filepath.Join(tmpDir, "gitconfig"))
	if err != nil {
		t.Fatalf("read gitconfig: %v", err)
	}
	gitconfig := string(gitconfigData)

	if !strings.Contains(gitconfig, "name = MyBot") {
		t.Errorf("gitconfig missing name, got:\n%s", gitconfig)
	}
	if !strings.Contains(gitconfig, "email = 261968324+mybot[bot]@users.noreply.github.com") {
		t.Errorf("gitconfig missing bot email, got:\n%s", gitconfig)
	}
	// Verify credential helper was added
	if !strings.Contains(gitconfig, "credential") {
		t.Errorf("gitconfig missing credential helper, got:\n%s", gitconfig)
	}
	if !strings.Contains(gitconfig, "moltnet github credential-helper") {
		t.Errorf("gitconfig missing moltnet credential helper command, got:\n%s", gitconfig)
	}

	// Verify config was updated with app_slug
	updated, _ := ReadConfigFrom(credPath)
	if updated.GitHub.AppSlug != "mybot" {
		t.Errorf("app_slug = %q, want %q", updated.GitHub.AppSlug, "mybot")
	}
	if updated.Git.Name != "MyBot" {
		t.Errorf("git name = %q, want %q", updated.Git.Name, "MyBot")
	}
	if updated.Git.Email != "261968324+mybot[bot]@users.noreply.github.com" {
		t.Errorf("git email = %q, want %q", updated.Git.Email, "261968324+mybot[bot]@users.noreply.github.com")
	}
}

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
