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
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestParseGitHubRepository(t *testing.T) {
	t.Parallel()
	tests := map[string]string{
		"getlarge/themoltnet":                              "getlarge/themoltnet",
		"https://github.com/getlarge/themoltnet.git":       "getlarge/themoltnet",
		"https://token@github.com/getlarge/themoltnet.git": "getlarge/themoltnet",
		"git@github.com:getlarge/themoltnet.git":           "getlarge/themoltnet",
		"ssh://git@github.com/getlarge/themoltnet.git":     "getlarge/themoltnet",
	}
	for input, want := range tests {
		repository, err := parseGitHubRepository(input)
		if err != nil {
			t.Fatalf("parse %q: %v", input, err)
		}
		if repository.String() != want {
			t.Fatalf("parse %q = %q, want %q", input, repository, want)
		}
	}
	if _, err := parseGitHubRepository("https://gitlab.com/getlarge/themoltnet.git"); err == nil {
		t.Fatal("expected non-GitHub remote to be rejected")
	}
}

func TestGitHubTokenRequestExplicitRepositoryPrecedesRemote(t *testing.T) {
	old := gitRemoteURL
	gitRemoteURL = func() (string, error) { return "git@github.com:wrong/repository.git", nil }
	defer func() { gitRemoteURL = old }()

	request, err := githubTokenRequestForGHArgs([]string{"-R", "right/repository", "issue", "edit", "1"})
	if err != nil {
		t.Fatal(err)
	}
	if got := request.Repository.String(); got != "right/repository" {
		t.Fatalf("repository = %q", got)
	}
	if got := request.Permissions["issues"]; got != "write" {
		t.Fatalf("issues permission = %q", got)
	}
}

func TestRepositoryTokenCacheIsolatesInstallationsRepositoriesAndPermissions(t *testing.T) {
	keyPath := filepath.Join(t.TempDir(), "app.pem")
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(keyPath, pem.EncodeToMemory(&pem.Block{
		Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(privateKey),
	}), 0o600); err != nil {
		t.Fatal(err)
	}

	var tokenRequests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/repos/org-a/project/installation":
			_, _ = w.Write([]byte(`{"id":101}`))
		case r.Method == http.MethodGet && r.URL.Path == "/repos/org-b/project/installation":
			_, _ = w.Write([]byte(`{"id":202}`))
		case r.Method == http.MethodPost && (r.URL.Path == "/app/installations/101/access_tokens" || r.URL.Path == "/app/installations/202/access_tokens"):
			tokenRequests.Add(1)
			var body struct {
				Repositories []string          `json:"repositories"`
				Permissions  map[string]string `json:"permissions"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Errorf("decode token request: %v", err)
			}
			if len(body.Repositories) != 1 || body.Repositories[0] != "project" {
				t.Errorf("repositories = %#v", body.Repositories)
			}
			w.WriteHeader(http.StatusCreated)
			_, _ = fmt.Fprintf(w, `{"token":%q,"expires_at":%q,"permissions":%s}`,
				"token-"+r.URL.Path+"-"+body.Permissions["issues"],
				time.Now().Add(time.Hour).UTC().Format(time.RFC3339), marshalTestJSON(t, body.Permissions))
		default:
			http.Error(w, r.Method+" "+r.URL.Path, http.StatusNotFound)
		}
	}))
	defer server.Close()
	old := githubAPIBaseURL
	githubAPIBaseURL = server.URL
	defer func() { githubAPIBaseURL = old }()

	source := githubKeySourceFromPath(keyPath)
	requests := []githubTokenRequest{
		{Repository: githubRepository{Owner: "org-a", Name: "project"}, Permissions: map[string]string{"issues": "read"}},
		{Repository: githubRepository{Owner: "org-a", Name: "project"}, Permissions: map[string]string{"issues": "write"}},
		{Repository: githubRepository{Owner: "org-b", Name: "project"}, Permissions: map[string]string{"issues": "write"}},
	}
	for _, request := range requests {
		if _, err := getCachedTokenDetailsForRequest(context.Background(), server.Client(), "app", source, request, 0); err != nil {
			t.Fatal(err)
		}
	}
	var group sync.WaitGroup
	for range 20 {
		for _, request := range requests {
			group.Add(1)
			go func(request githubTokenRequest) {
				defer group.Done()
				if _, err := getCachedTokenDetailsForRequest(context.Background(), server.Client(), "app", source, request, 0); err != nil {
					t.Errorf("concurrent cache read: %v", err)
				}
			}(request)
		}
	}
	group.Wait()
	if got := tokenRequests.Load(); got != 3 {
		t.Fatalf("token requests = %d, want 3", got)
	}
	entries, err := os.ReadDir(filepath.Join(filepath.Dir(keyPath), "gh-token-cache"))
	if err != nil {
		t.Fatal(err)
	}
	jsonFiles := 0
	for _, entry := range entries {
		if !strings.HasSuffix(entry.Name(), ".json") || strings.HasSuffix(entry.Name(), ".error.json") {
			continue
		}
		jsonFiles++
		data, err := os.ReadFile(filepath.Join(filepath.Dir(keyPath), "gh-token-cache", entry.Name()))
		if err != nil {
			t.Fatal(err)
		}
		var cached tokenCache
		if err := json.Unmarshal(data, &cached); err != nil {
			t.Fatalf("invalid concurrent cache %s: %v", entry.Name(), err)
		}
	}
	if jsonFiles != 3 {
		t.Fatalf("cache files = %d, want 3", jsonFiles)
	}
}

func TestCredentialRepositoryUsesGitRequestPath(t *testing.T) {
	repository, err := githubRepositoryFromCredentialPath("github.com", "getlarge/themoltnet.git")
	if err != nil {
		t.Fatal(err)
	}
	if got := repository.String(); got != "getlarge/themoltnet" {
		t.Fatalf("repository = %q", got)
	}
}

func TestCredentialHelperMintsForRequestedRepositoryPath(t *testing.T) {
	directory := t.TempDir()
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	keyPath := filepath.Join(directory, "app.pem")
	if err := os.WriteFile(keyPath, pem.EncodeToMemory(&pem.Block{
		Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(privateKey),
	}), 0o600); err != nil {
		t.Fatal(err)
	}
	var resolvedPath, tokenPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			resolvedPath = r.URL.Path
			_, _ = w.Write([]byte(`{"id":404}`))
		case http.MethodPost:
			tokenPath = r.URL.Path
			w.WriteHeader(http.StatusCreated)
			_, _ = fmt.Fprintf(w, `{"token":"credential-token","expires_at":%q,"permissions":{"contents":"write"}}`, time.Now().Add(time.Hour).UTC().Format(time.RFC3339))
		default:
			http.Error(w, "unexpected method", http.StatusMethodNotAllowed)
		}
	}))
	defer server.Close()
	oldAPI := githubAPIBaseURL
	githubAPIBaseURL = server.URL
	defer func() { githubAPIBaseURL = oldAPI }()

	credentialsPath := filepath.Join(directory, "moltnet.json")
	credentials := &CredentialsFile{GitHub: &GitHubSection{AppID: "app", PrivateKeyPath: keyPath}}
	if _, err := WriteConfigTo(credentials, credentialsPath); err != nil {
		t.Fatal(err)
	}
	var output strings.Builder
	request := strings.NewReader("protocol=https\nhost=github.com\npath=another-org/project.git\n\n")
	if err := runGitHubCredentialHelperIOCmd(credentialsPath, request, &output); err != nil {
		t.Fatal(err)
	}
	if resolvedPath != "/repos/another-org/project/installation" {
		t.Fatalf("installation lookup path = %q", resolvedPath)
	}
	if tokenPath != "/app/installations/404/access_tokens" {
		t.Fatalf("token path = %q", tokenPath)
	}
	if got := output.String(); !strings.Contains(got, "password=credential-token") {
		t.Fatalf("credential output = %q", got)
	}
}

func marshalTestJSON(t *testing.T, value any) string {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}
