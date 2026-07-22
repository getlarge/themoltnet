package main

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
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

func TestRunGitHubSetup_WritesInsteadOfIdempotent(t *testing.T) {
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

	// Run setup twice.
	if err := runGitHubSetupCmd(credPath, "", "mybot"); err != nil {
		t.Fatalf("first setup: %v", err)
	}
	if err := runGitHubSetupCmd(credPath, "", "mybot"); err != nil {
		t.Fatalf("second setup: %v", err)
	}

	gitconfigPath := filepath.Join(tmpDir, "gitconfig")
	b, _ := os.ReadFile(gitconfigPath)
	cfg := string(b)
	if strings.Count(cfg, `[credential "https://github.com"]`) != 1 {
		t.Fatalf("credential block not idempotent (count != 1):\n%s", cfg)
	}
	if strings.Count(cfg, "insteadOf = git@github.com:") != 1 {
		t.Fatalf("insteadOf not idempotent (count != 1):\n%s", cfg)
	}
	if hasTokenBearingRule(cfg) {
		t.Fatalf("setup must not embed a token:\n%s", cfg)
	}
}

func TestRunGitHubToken_NoGitHub(t *testing.T) {
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

	err := runGitHubToken([]string{"--credentials", credPath})
	if err == nil {
		t.Fatal("expected error for missing GitHub section")
	}
	if !strings.Contains(err.Error(), "GitHub App not configured") {
		t.Errorf("error = %v, want mention of GitHub App", err)
	}
}

func TestRunGitHubToken_EnvFallback(t *testing.T) {
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

	t.Setenv("MOLTNET_CREDENTIALS_PATH", credPath)

	err := runGitHubToken(nil)
	if err == nil {
		t.Fatal("expected error for missing GitHub section")
	}
	if !strings.Contains(err.Error(), "GitHub App not configured") {
		t.Errorf("error = %v, want mention of GitHub App", err)
	}
}

func TestGetInstallationToken_MissingKeyFile(t *testing.T) {
	_, _, err := getInstallationToken("12345", "/nonexistent/path/key.pem", "67890")
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

func TestGetCachedInstallationToken_CacheHit(t *testing.T) {
	tmpDir := t.TempDir()
	keyPath := filepath.Join(tmpDir, "private-key.pem")
	os.WriteFile(keyPath, []byte("dummy"), 0o600)

	// Write a valid cache file with token expiring in 1 hour
	expiresAt := time.Now().Add(1 * time.Hour).UTC().Format(time.RFC3339)
	cache := tokenCache{
		Token:       "ghs_cached_token",
		ExpiresAt:   expiresAt,
		Permissions: map[string]string{"contents": "write"},
	}
	cacheData, _ := json.Marshal(cache)
	os.WriteFile(filepath.Join(tmpDir, "gh-token-cache.json"), cacheData, 0o600)

	token, err := getCachedInstallationToken("12345", keyPath, "67890")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if token != "ghs_cached_token" {
		t.Errorf("token = %q, want %q", token, "ghs_cached_token")
	}
}

func TestGetCachedInstallationTokenDetails_CachesInstallationPermissions(t *testing.T) {
	tmpDir := t.TempDir()
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	keyPath := filepath.Join(tmpDir, "private-key.pem")
	keyData := pem.EncodeToMemory(&pem.Block{
		Type:  "RSA PRIVATE KEY",
		Bytes: x509.MarshalPKCS1PrivateKey(privateKey),
	})
	if err := os.WriteFile(keyPath, keyData, 0o600); err != nil {
		t.Fatalf("write key: %v", err)
	}

	expiresAt := time.Now().Add(time.Hour).UTC().Format(time.RFC3339)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/app/installations/67890/access_tokens" || r.Method != http.MethodPost {
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		fmt.Fprintf(w, `{"token":"ghs_fresh","expires_at":%q,"permissions":{"issues":"read","pull_requests":"write"}}`, expiresAt)
	}))
	defer server.Close()

	old := githubAPIBaseURL
	githubAPIBaseURL = server.URL
	defer func() { githubAPIBaseURL = old }()

	details, err := getCachedInstallationTokenDetails(
		context.Background(),
		server.Client(),
		"12345",
		keyPath,
		"67890",
	)
	if err != nil {
		t.Fatalf("get token details: %v", err)
	}
	if details.Token != "ghs_fresh" || details.Permissions["pull_requests"] != "write" {
		t.Fatalf("unexpected token details: %#v", details)
	}

	cacheData, err := os.ReadFile(filepath.Join(tmpDir, "gh-token-cache.json"))
	if err != nil {
		t.Fatalf("read cache: %v", err)
	}
	var cached tokenCache
	if err := json.Unmarshal(cacheData, &cached); err != nil {
		t.Fatalf("parse cache: %v", err)
	}
	if cached.Permissions["issues"] != "read" || cached.Permissions["pull_requests"] != "write" {
		t.Fatalf("permissions not cached: %#v", cached.Permissions)
	}
}

func TestGetCachedInstallationTokenDetails_RefreshesLegacyCacheWithoutPermissions(t *testing.T) {
	tmpDir := t.TempDir()
	keyPath := filepath.Join(tmpDir, "private-key.pem")
	if err := os.WriteFile(keyPath, []byte("dummy"), 0o600); err != nil {
		t.Fatalf("write key: %v", err)
	}
	cache := tokenCache{
		Token:     "ghs_legacy",
		ExpiresAt: time.Now().Add(time.Hour).UTC().Format(time.RFC3339),
	}
	cacheData, _ := json.Marshal(cache)
	if err := os.WriteFile(filepath.Join(tmpDir, "gh-token-cache.json"), cacheData, 0o600); err != nil {
		t.Fatalf("write cache: %v", err)
	}

	_, err := getCachedInstallationTokenDetails(
		context.Background(),
		http.DefaultClient,
		"12345",
		keyPath,
		"67890",
	)
	if err == nil || !strings.Contains(err.Error(), "failed to decode PEM block") {
		t.Fatalf("expected legacy cache refresh, got: %v", err)
	}
}

func TestGetCachedInstallationToken_CacheExpired(t *testing.T) {
	tmpDir := t.TempDir()
	keyPath := filepath.Join(tmpDir, "private-key.pem")
	os.WriteFile(keyPath, []byte("dummy"), 0o600)

	// Write a cache file with token expiring in 2 minutes (within 5-min buffer)
	expiresAt := time.Now().Add(2 * time.Minute).UTC().Format(time.RFC3339)
	cache := tokenCache{Token: "ghs_old_token", ExpiresAt: expiresAt}
	cacheData, _ := json.Marshal(cache)
	os.WriteFile(filepath.Join(tmpDir, "gh-token-cache.json"), cacheData, 0o600)

	// This will fail because the dummy key can't produce a valid JWT,
	// but it proves the cache was NOT used (it tried to fetch a fresh token).
	_, err := getCachedInstallationToken("12345", keyPath, "67890")
	if err == nil {
		t.Fatal("expected error from fetching fresh token with dummy key")
	}
	// The error should come from PEM decoding, not from cache reading
	if !strings.Contains(err.Error(), "failed to decode PEM block") {
		t.Errorf("expected PEM decode error, got: %v", err)
	}
}

func TestGetCachedInstallationToken_CacheMissing(t *testing.T) {
	tmpDir := t.TempDir()
	keyPath := filepath.Join(tmpDir, "private-key.pem")
	os.WriteFile(keyPath, []byte("dummy"), 0o600)

	// No cache file — should attempt to fetch, fail on dummy key
	_, err := getCachedInstallationToken("12345", keyPath, "67890")
	if err == nil {
		t.Fatal("expected error from fetching token with dummy key")
	}
	if !strings.Contains(err.Error(), "failed to decode PEM block") {
		t.Errorf("expected PEM decode error, got: %v", err)
	}
}
