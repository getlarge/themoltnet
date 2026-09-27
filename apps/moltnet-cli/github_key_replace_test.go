package main

import (
	"bytes"
	"context"
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
)

const replaceFixtureAppID = "4242"

type githubKeyReplaceFixture struct {
	credentialsPath string
	newKeyPath      string
	newPEM          []byte
	oldPEM          string
	keyring         *memorySecretProvider
	registry        *SecretProviderRegistry
	appCalls        *atomic.Int32
}

// newGitHubKeyReplaceFixture serves GET /app, accepting only JWTs signed by
// the new key and answering with appIDFromServer.
func newGitHubKeyReplaceFixture(t *testing.T, appIDFromServer int64) *githubKeyReplaceFixture {
	t.Helper()
	dir := t.TempDir()
	fixture := &githubKeyReplaceFixture{
		credentialsPath: filepath.Join(dir, "moltnet.json"),
		newKeyPath:      filepath.Join(t.TempDir(), "new.pem"),
		newPEM:          testRSAPrivateKeyPEM(t),
		oldPEM:          strings.TrimSuffix(string(testRSAPrivateKeyPEM(t)), "\n"),
		keyring:         &memorySecretProvider{values: map[string]string{}},
		appCalls:        &atomic.Int32{},
	}
	fixture.keyring.values[GitHubAppPrivateKeyKey(replaceFixtureAppID)] = fixture.oldPEM
	fixture.registry = NewSecretProviderRegistry()
	fixture.registry.Register(osKeyringProviderName, fixture.keyring)
	if err := os.WriteFile(fixture.newKeyPath, fixture.newPEM, privateFileMode); err != nil {
		t.Fatal(err)
	}
	document := map[string]any{
		"subject_id":   "00000000-0000-4000-8000-00000000c0de",
		"subject_type": "agent",
		"oauth2":       map[string]any{"client_id": "cid"},
		"keys":         map[string]any{"public_key": "ed25519:x", "fingerprint": "F"},
		"endpoints":    map[string]any{"api": "https://api.themolt.net", "mcp": "https://mcp.themolt.net/mcp"},
		"github": map[string]any{
			"app_id":          replaceFixtureAppID,
			"installation_id": "1",
			"private_key_ref": map[string]string{"provider": osKeyringProviderName, "key": GitHubAppPrivateKeyKey(replaceFixtureAppID)},
		},
	}
	data, err := json.MarshalIndent(document, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(fixture.credentialsPath, data, privateFileMode); err != nil {
		t.Fatal(err)
	}
	// Token caches written by earlier commands must be cleared by a replace.
	for _, path := range []string{filepath.Join(dir, "gh-token-cache", "entry.json"), filepath.Join(dir, "gh-token-cache-error.json")} {
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("{}"), privateFileMode); err != nil {
			t.Fatal(err)
		}
	}

	newKey, err := parseRSAPrivateKey(fixture.newPEM)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/app" || r.Method != http.MethodGet {
			http.NotFound(w, r)
			return
		}
		fixture.appCalls.Add(1)
		if !jwtSignedBy(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "), &newKey.PublicKey) {
			http.Error(w, `{"message":"A JSON web token could not be decoded"}`, http.StatusUnauthorized)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"id": appIDFromServer, "slug": "fixture-app"})
	}))
	t.Cleanup(server.Close)
	old := githubAPIBaseURL
	githubAPIBaseURL = server.URL
	t.Cleanup(func() { githubAPIBaseURL = old })
	return fixture
}

func jwtSignedBy(token string, key *rsa.PublicKey) bool {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return false
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return false
	}
	digest := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	return rsa.VerifyPKCS1v15(key, crypto.SHA256, digest[:], signature) == nil
}

func (f *githubKeyReplaceFixture) opts() githubKeyReplaceOpts {
	return githubKeyReplaceOpts{
		credentialsPath: f.credentialsPath,
		privateKeyPath:  f.newKeyPath,
		providers:       f.registry,
		httpClient:      http.DefaultClient,
	}
}

func (f *githubKeyReplaceFixture) storedKey() string {
	return f.keyring.values[GitHubAppPrivateKeyKey(replaceFixtureAppID)]
}

func TestGitHubKeyReplaceStoresVerifiedKeyInPlace(t *testing.T) {
	fixture := newGitHubKeyReplaceFixture(t, 4242)
	before, _ := os.ReadFile(fixture.credentialsPath)
	var out, errOut bytes.Buffer

	if err := runGitHubKeyReplaceCmd(context.Background(), &out, &errOut, fixture.opts()); err != nil {
		t.Fatalf("replace: %v", err)
	}

	if fixture.storedKey() != stripOneNewline(string(fixture.newPEM)) {
		t.Fatal("the stored key was not replaced with the new PEM")
	}
	if after, _ := os.ReadFile(fixture.credentialsPath); !bytes.Equal(before, after) {
		t.Fatal("replace must not rewrite moltnet.json")
	}
	var result githubKeyReplaceOutput
	if err := json.Unmarshal(out.Bytes(), &result); err != nil {
		t.Fatalf("parse output: %v\n%s", err, out.String())
	}
	if !result.KeyVerified || !result.SecretReplaced || !result.TokenCacheReset || result.Reference.Provider != osKeyringProviderName {
		t.Fatalf("unexpected result: %+v", result)
	}
	dir := filepath.Dir(fixture.credentialsPath)
	for _, path := range []string{filepath.Join(dir, "gh-token-cache"), filepath.Join(dir, "gh-token-cache-error.json")} {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Fatalf("token cache %s survived the replace", path)
		}
	}
	for _, stream := range []string{out.String(), errOut.String()} {
		if strings.Contains(stream, "PRIVATE KEY") {
			t.Fatalf("PEM leaked into output:\n%s", stream)
		}
	}
	if !strings.Contains(errOut.String(), "delete the old key") {
		t.Fatalf("missing the GitHub-side follow-up: %s", errOut.String())
	}
}

func TestGitHubKeyReplaceRejectsKeysGitHubDoesNotAccept(t *testing.T) {
	t.Run("key of another App", func(t *testing.T) {
		fixture := newGitHubKeyReplaceFixture(t, 999)
		err := runGitHubKeyReplaceCmd(context.Background(), &bytes.Buffer{}, nil, fixture.opts())
		if err == nil || !strings.Contains(err.Error(), "belongs to GitHub App 999") {
			t.Fatalf("expected an App mismatch, got %v", err)
		}
		if fixture.storedKey() != fixture.oldPEM {
			t.Fatal("a rejected key replaced the stored one")
		}
	})
	t.Run("key GitHub rejects", func(t *testing.T) {
		fixture := newGitHubKeyReplaceFixture(t, 4242)
		// A key the server does not know signs the JWT.
		if err := os.WriteFile(fixture.newKeyPath, testRSAPrivateKeyPEM(t), privateFileMode); err != nil {
			t.Fatal(err)
		}
		err := runGitHubKeyReplaceCmd(context.Background(), &bytes.Buffer{}, nil, fixture.opts())
		if err == nil || !strings.Contains(err.Error(), "HTTP 401") {
			t.Fatalf("expected GitHub to reject the key, got %v", err)
		}
		if fixture.storedKey() != fixture.oldPEM {
			t.Fatal("a rejected key replaced the stored one")
		}
	})
}

func TestGitHubKeyReplaceFailsBeforeContactingGitHub(t *testing.T) {
	for _, tc := range []struct {
		name  string
		setup func(t *testing.T, f *githubKeyReplaceFixture)
		want  string
	}{
		{
			name: "unwritable provider",
			setup: func(t *testing.T, f *githubKeyReplaceFixture) {
				f.registry.Register(osKeyringProviderName, EnvironmentSecretProvider{})
			},
			want: "not writable",
		},
		{
			name: "not a PEM",
			setup: func(t *testing.T, f *githubKeyReplaceFixture) {
				if err := os.WriteFile(f.newKeyPath, []byte("not a key"), privateFileMode); err != nil {
					t.Fatal(err)
				}
			},
			want: "not an RSA private key",
		},
		{
			name: "legacy PEM path",
			setup: func(t *testing.T, f *githubKeyReplaceFixture) {
				data := []byte(`{"subject_id":"s","subject_type":"agent","oauth2":{"client_id":"cid"},"keys":{},"endpoints":{},"github":{"app_id":"4242","private_key_path":"/tmp/app.pem"}}`)
				if err := os.WriteFile(f.credentialsPath, data, privateFileMode); err != nil {
					t.Fatal(err)
				}
			},
			want: "config migrate",
		},
		{
			name: "unbound reference",
			setup: func(t *testing.T, f *githubKeyReplaceFixture) {
				data := []byte(`{"subject_id":"s","subject_type":"agent","oauth2":{"client_id":"cid"},"keys":{},"endpoints":{},"github":{"app_id":"4242","private_key_ref":{"provider":"os-keyring","key":"github-app/1/private-key"}}}`)
				if err := os.WriteFile(f.credentialsPath, data, privateFileMode); err != nil {
					t.Fatal(err)
				}
			},
			want: "not bound",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fixture := newGitHubKeyReplaceFixture(t, 4242)
			tc.setup(t, fixture)
			err := runGitHubKeyReplaceCmd(context.Background(), &bytes.Buffer{}, nil, fixture.opts())
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("expected %q, got %v", tc.want, err)
			}
			if calls := fixture.appCalls.Load(); calls != 0 {
				t.Fatalf("GitHub was contacted %d times", calls)
			}
			if fixture.storedKey() != fixture.oldPEM {
				t.Fatal("the stored key changed")
			}
		})
	}
}
