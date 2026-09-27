package main

import (
	"bytes"
	"context"
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
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
	// onVerify runs while GitHub is checking the new key.
	onVerify func()
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
		if fixture.onVerify != nil {
			fixture.onVerify()
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

func (f *githubKeyReplaceFixture) editGitHubSection(t *testing.T, edit func(github map[string]any)) {
	t.Helper()
	data, err := os.ReadFile(f.credentialsPath)
	if err != nil {
		t.Fatal(err)
	}
	var document map[string]any
	if err := json.Unmarshal(data, &document); err != nil {
		t.Fatal(err)
	}
	edit(document["github"].(map[string]any))
	data, err = json.MarshalIndent(document, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(f.credentialsPath, data, privateFileMode); err != nil {
		t.Fatal(err)
	}
}

func TestGitHubKeyReplaceRejectsAnAmbiguousConfig(t *testing.T) {
	fixture := newGitHubKeyReplaceFixture(t, 4242)
	fixture.editGitHubSection(t, func(github map[string]any) {
		github["private_key_path"] = "/tmp/app.pem"
	})

	err := runGitHubKeyReplaceCmd(context.Background(), &bytes.Buffer{}, nil, fixture.opts())

	if err == nil || !strings.Contains(err.Error(), "exactly one of private_key_path or private_key_ref") {
		t.Fatalf("expected an ambiguity error, got %v", err)
	}
	if fixture.appCalls.Load() != 0 || fixture.storedKey() != fixture.oldPEM {
		t.Fatal("an ambiguous config must be rejected before anything happens")
	}
}

func TestGitHubKeyReplaceRechecksTheReferenceBeforeStoring(t *testing.T) {
	fixture := newGitHubKeyReplaceFixture(t, 4242)
	// A concurrent credential copy moves the reference while GitHub verifies.
	fixture.onVerify = func() {
		fixture.editGitHubSection(t, func(github map[string]any) {
			github["private_key_ref"] = map[string]string{"provider": fileProviderName, "key": GitHubAppPrivateKeyKey(replaceFixtureAppID)}
		})
	}

	err := runGitHubKeyReplaceCmd(context.Background(), &bytes.Buffer{}, nil, fixture.opts())

	if err == nil || !strings.Contains(err.Error(), "changed while the key was being verified") {
		t.Fatalf("expected a changed-reference error, got %v", err)
	}
	if fixture.storedKey() != fixture.oldPEM {
		t.Fatal("a no-longer-active entry was replaced")
	}
}

// replaceFailingProvider is a writable provider whose write or read-back fails.
type replaceFailingProvider struct {
	memorySecretProvider
	failSet     bool
	corruptRead bool
}

func (p *replaceFailingProvider) Set(key, value string) error {
	if p.failSet {
		return errors.New("keychain locked")
	}
	return p.memorySecretProvider.Set(key, value)
}

func (p *replaceFailingProvider) Get(key string) (string, error) {
	value, err := p.memorySecretProvider.Get(key)
	if p.corruptRead && err == nil && value != "" {
		return value + "-corrupted", nil
	}
	return value, err
}

func TestGitHubKeyReplaceReportsProviderFailures(t *testing.T) {
	t.Run("the write fails", func(t *testing.T) {
		fixture := newGitHubKeyReplaceFixture(t, 4242)
		provider := &replaceFailingProvider{memorySecretProvider: *fixture.keyring, failSet: true}
		fixture.registry.Register(osKeyringProviderName, provider)

		err := runGitHubKeyReplaceCmd(context.Background(), &bytes.Buffer{}, nil, fixture.opts())

		if err == nil || !strings.Contains(err.Error(), "the old key is unchanged") {
			t.Fatalf("expected an unchanged-key failure, got %v", err)
		}
		if provider.values[GitHubAppPrivateKeyKey(replaceFixtureAppID)] != fixture.oldPEM {
			t.Fatal("a failed write changed the stored key")
		}
	})
	t.Run("the read-back does not match", func(t *testing.T) {
		fixture := newGitHubKeyReplaceFixture(t, 4242)
		provider := &replaceFailingProvider{memorySecretProvider: *fixture.keyring, corruptRead: true}
		fixture.registry.Register(osKeyringProviderName, provider)

		err := runGitHubKeyReplaceCmd(context.Background(), &bytes.Buffer{}, nil, fixture.opts())

		if err == nil || !strings.Contains(err.Error(), "could not verify it") || !strings.Contains(err.Error(), "before deleting the old key on GitHub") {
			t.Fatalf("expected an unverified-write failure, got %v", err)
		}
		if provider.values[GitHubAppPrivateKeyKey(replaceFixtureAppID)] != stripOneNewline(string(fixture.newPEM)) {
			t.Fatal("the write happened, so the stored value must be the new key")
		}
	})
}

// TestGitHubKeyReplaceCommand runs the user-facing command against a
// file-backed reference, with --credentials and the required --private-key.
func TestGitHubKeyReplaceCommand(t *testing.T) {
	fixture := newGitHubKeyReplaceFixture(t, 4242)
	root := t.TempDir()
	t.Setenv(secretRootEnv, root)
	t.Setenv(secretRootWritableEnv, "1")
	ref := SecretReference{Provider: fileProviderName, Key: GitHubAppPrivateKeyKey(replaceFixtureAppID)}
	if err := (FileSecretProvider{Root: root, Writable: true}).Set(ref.Key, fixture.oldPEM); err != nil {
		t.Fatal(err)
	}
	fixture.editGitHubSection(t, func(github map[string]any) {
		github["private_key_ref"] = ref
	})

	if _, _, err := executeCommand(NewRootCmd("test", ""), "--credentials", fixture.credentialsPath, "github", "key", "replace"); err == nil {
		t.Fatal("--private-key must be required")
	}
	stdout, stderr, err := executeCommand(NewRootCmd("test", ""),
		"--credentials", fixture.credentialsPath,
		"github", "key", "replace", "--private-key", fixture.newKeyPath)
	if err != nil {
		t.Fatalf("github key replace: %v\n%s", err, stderr)
	}

	stored, err := FileSecretProvider{Root: root}.Get(ref.Key)
	if err != nil || stored != stripOneNewline(string(fixture.newPEM)) {
		t.Fatalf("the file-backed key was not replaced: %v", err)
	}
	if strings.Contains(stdout+stderr, "PRIVATE KEY") {
		t.Fatal("the PEM leaked into command output")
	}
}
