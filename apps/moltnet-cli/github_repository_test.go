package main

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
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
		// installation-*.json records the repository->installation mapping, not
		// a token; it is keyed per repository, not per permission set.
		if !strings.HasSuffix(entry.Name(), ".json") ||
			strings.HasSuffix(entry.Name(), ".error.json") ||
			strings.HasPrefix(entry.Name(), "installation-") {
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

// TestExplicitGitHubRepositoryIgnoresFlagValues covers the guard-bypass shape
// from #2211: a free-text flag value that merely looks like a repository flag
// must not decide which repository is authorized or scoped. Positions whose
// meaning cannot be proven report ambiguity so callers fail closed.
func TestExplicitGitHubRepositoryIgnoresFlagValues(t *testing.T) {
	for _, testCase := range []struct {
		name      string
		args      []string
		want      string
		found     bool
		ambiguous bool
		err       bool
	}{
		{
			name: "body value that looks like an attached repo flag",
			args: []string{"issue", "comment", "1", "--body", "-Rattacker/spoof"},
		},
		{
			name: "body value that looks like a long repo flag",
			args: []string{"issue", "comment", "1", "--body", "--repo=attacker/spoof"},
		},
		{
			name: "body value consuming a separated repo flag",
			args: []string{"issue", "comment", "1", "--body", "-R", "attacker/spoof"},
		},
		{
			name: "repo flag after the end-of-flags terminator",
			args: []string{"api", "x", "--", "-R", "attacker/spoof"},
		},
		{
			name:      "attached shorthand is ambiguous, not guessed",
			args:      []string{"issue", "comment", "1", "-Rowner/repo"},
			ambiguous: true,
		},
		{
			// -m is --milestone (a value) on pr create but --merge (a boolean) on
			// pr merge, so a following -R cannot be trusted either way.
			name:      "repo flag after an unknown-arity short flag is ambiguous",
			args:      []string{"pr", "merge", "123", "-m", "-R", "owner/repo"},
			ambiguous: true,
		},
		{
			name:      "repo flag after a short free-text flag is ambiguous",
			args:      []string{"pr", "create", "-b", "-R", "owner/repo"},
			ambiguous: true,
		},
		{
			name:  "repo flag after a known long boolean still resolves",
			args:  []string{"pr", "create", "--draft", "-R", "owner/repo"},
			want:  "owner/repo",
			found: true,
		},
		{
			name:  "repo flag after a known long value pair still resolves",
			args:  []string{"issue", "comment", "1", "--body", "text", "-R", "owner/repo"},
			want:  "owner/repo",
			found: true,
		},
		{
			name:  "separated shorthand at a proven position resolves",
			args:  []string{"issue", "comment", "1", "-R", "owner/repo"},
			want:  "owner/repo",
			found: true,
		},
		{
			name:  "long form resolves",
			args:  []string{"issue", "comment", "1", "--repo", "owner/repo"},
			want:  "owner/repo",
			found: true,
		},
		{
			name:  "assigned long form resolves",
			args:  []string{"issue", "comment", "1", "--repo=owner/repo"},
			want:  "owner/repo",
			found: true,
		},
		{
			name:  "unrecognized long assigned flag does not poison the position",
			args:  []string{"pr", "create", "--some-future-flag=x", "-R", "owner/repo"},
			want:  "owner/repo",
			found: true,
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			repository, found, err := explicitGitHubRepository(testCase.args)
			switch {
			case testCase.ambiguous:
				if !errors.Is(err, errAmbiguousGitHubRepositoryFlag) {
					t.Fatalf("expected ambiguity, got repository %q err %v", repository, err)
				}
				return
			case testCase.err:
				if err == nil {
					t.Fatalf("expected an error, got repository %q", repository)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if found != testCase.found {
				t.Fatalf("found = %v, want %v", found, testCase.found)
			}
			if repository.String() != testCase.want {
				t.Fatalf("repository = %q, want %q", repository, testCase.want)
			}
		})
	}
}

func TestParseGitHubRepositoryTrimsSuffixAfterSlashes(t *testing.T) {
	for _, remote := range []string{
		"https://github.com/owner/repo.git/",
		"https://github.com/owner/repo.git",
		"https://github.com/owner/repo/",
		"git@github.com:owner/repo.git",
	} {
		repository, err := parseGitHubRepository(remote)
		if err != nil {
			t.Fatalf("%s: %v", remote, err)
		}
		if repository.String() != "owner/repo" {
			t.Fatalf("%s: repository = %q, want owner/repo", remote, repository)
		}
	}
}

// TestCredentialRepositoryFallsBackToRemote covers the upgrade path: gitconfigs
// written before credential.useHttpPath existed send no path=, which must not
// break git push.
func TestCredentialRepositoryFallsBackToRemote(t *testing.T) {
	original := gitRemoteURL
	defer func() { gitRemoteURL = original }()

	gitRemoteURL = func() (string, error) { return "https://github.com/owner/from-remote.git", nil }
	repository, err := githubRepositoryForCredentialRequest("github.com", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if repository.String() != "owner/from-remote" {
		t.Fatalf("repository = %q, want owner/from-remote", repository)
	}

	// An explicit path still wins over the remote.
	repository, err = githubRepositoryForCredentialRequest("github.com", "owner/from-path.git")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if repository.String() != "owner/from-path" {
		t.Fatalf("repository = %q, want owner/from-path", repository)
	}

	// With neither a path nor a remote, the error must name the recovery step.
	gitRemoteURL = func() (string, error) { return "", fmt.Errorf("no remote") }
	if _, err = githubRepositoryForCredentialRequest("github.com", ""); err == nil {
		t.Fatal("expected an error with no path and no remote")
	} else if !strings.Contains(err.Error(), "moltnet github setup") {
		t.Fatalf("error %q does not name the recovery step", err)
	}

	// A non-GitHub host is still rejected before any remote lookup.
	if _, err := githubRepositoryForCredentialRequest("gitlab.com", ""); err == nil {
		t.Fatal("expected a non-github.com host to be rejected")
	}
}

// TestWarmTokenCacheMakesNoNetworkCall covers the hot-path regression from
// #2211: the installation was resolved before the cache was read, so a warm
// cache hit still cost an App-JWT-signed request on every guarded write,
// credential-helper invocation and `github exec`.
func TestWarmTokenCacheMakesNoNetworkCall(t *testing.T) {
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

	var installationRequests, tokenRequests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/repos/org/project/installation":
			installationRequests.Add(1)
			_, _ = w.Write([]byte(`{"id":101,"permissions":{"issues":"write","contents":"read"}}`))
		case r.Method == http.MethodPost && r.URL.Path == "/app/installations/101/access_tokens":
			tokenRequests.Add(1)
			w.WriteHeader(http.StatusCreated)
			_, _ = fmt.Fprintf(w, `{"token":"t","expires_at":%q,"permissions":{"issues":"write"}}`,
				time.Now().Add(time.Hour).UTC().Format(time.RFC3339))
		default:
			http.Error(w, r.Method+" "+r.URL.Path, http.StatusNotFound)
		}
	}))
	defer server.Close()
	old := githubAPIBaseURL
	githubAPIBaseURL = server.URL
	defer func() { githubAPIBaseURL = old }()

	source := githubKeySourceFromPath(keyPath)
	request := githubTokenRequest{
		Repository:  githubRepository{Owner: "org", Name: "project"},
		Permissions: map[string]string{"issues": "write"},
	}

	// Cold: one installation lookup, one mint.
	if _, err := getCachedTokenDetailsForRequest(context.Background(), server.Client(), "app", source, request, 0); err != nil {
		t.Fatal(err)
	}
	if got := installationRequests.Load(); got != 1 {
		t.Fatalf("cold installation requests = %d, want 1", got)
	}
	if got := tokenRequests.Load(); got != 1 {
		t.Fatalf("cold token requests = %d, want 1", got)
	}

	// Warm: the cached token must satisfy the request with no network at all.
	for range 5 {
		if _, err := getCachedTokenDetailsForRequest(context.Background(), server.Client(), "app", source, request, 0); err != nil {
			t.Fatal(err)
		}
	}
	if got := installationRequests.Load(); got != 1 {
		t.Fatalf("warm cache made %d installation requests, want it to stay at 1", got)
	}
	if got := tokenRequests.Load(); got != 1 {
		t.Fatalf("warm cache made %d token requests, want it to stay at 1", got)
	}
}

// TestInstallationPermissionsNeedNoToken covers the guard reading its
// permission set off the installation object instead of minting (and caching) a
// full-permission repository token just to read `.Permissions` back.
func TestInstallationPermissionsNeedNoToken(t *testing.T) {
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

	var installationRequests, tokenRequests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/repos/org/project/installation":
			installationRequests.Add(1)
			_, _ = w.Write([]byte(`{"id":101,"permissions":{"issues":"write"}}`))
		case r.Method == http.MethodPost:
			tokenRequests.Add(1)
			http.Error(w, "the guard must not mint a token", http.StatusInternalServerError)
		default:
			http.Error(w, r.Method+" "+r.URL.Path, http.StatusNotFound)
		}
	}))
	defer server.Close()
	old := githubAPIBaseURL
	githubAPIBaseURL = server.URL
	defer func() { githubAPIBaseURL = old }()

	source := githubKeySourceFromPath(keyPath)
	repository := githubRepository{Owner: "org", Name: "project"}

	installation, err := resolveGitHubInstallationCached(
		context.Background(), server.Client(), "app", source, repository, 0)
	if err != nil {
		t.Fatal(err)
	}
	if installation.Permissions["issues"] != "write" {
		t.Fatalf("permissions = %#v, want issues=write", installation.Permissions)
	}
	if got := tokenRequests.Load(); got != 0 {
		t.Fatalf("minted %d tokens to read permissions, want 0", got)
	}

	// The mapping is cached, so repeat resolutions make no further calls.
	for range 3 {
		if _, err := resolveGitHubInstallationCached(
			context.Background(), server.Client(), "app", source, repository, 0); err != nil {
			t.Fatal(err)
		}
	}
	if got := installationRequests.Load(); got != 1 {
		t.Fatalf("installation requests = %d, want 1 (cached)", got)
	}
}

// TestInstallationResolutionFailureIsNegativeCached covers the retry-storm gap:
// resolution is now the most likely offline failure, so a recent failure must
// suppress further attempts instead of re-paying the timeout per command.
func TestInstallationResolutionFailureIsNegativeCached(t *testing.T) {
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

	var attempts atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts.Add(1)
		http.Error(w, "not installed", http.StatusNotFound)
	}))
	defer server.Close()
	old := githubAPIBaseURL
	githubAPIBaseURL = server.URL
	defer func() { githubAPIBaseURL = old }()

	source := githubKeySourceFromPath(keyPath)
	repository := githubRepository{Owner: "org", Name: "project"}

	for range 4 {
		if _, err := resolveGitHubInstallationCached(
			context.Background(), server.Client(), "app", source, repository, 30*time.Second); err == nil {
			t.Fatal("expected resolution to fail")
		}
	}
	if got := attempts.Load(); got != 1 {
		t.Fatalf("made %d resolution attempts, want 1 (later ones suppressed)", got)
	}

	// A successful resolution after the TTL clears the suppression.
	attempts.Store(0)
	if _, err := resolveGitHubInstallationCached(
		context.Background(), server.Client(), "app", source, repository, 0); err == nil {
		t.Fatal("expected resolution to fail")
	}
	if got := attempts.Load(); got != 1 {
		t.Fatalf("with no failure TTL, made %d attempts, want 1", got)
	}
}
