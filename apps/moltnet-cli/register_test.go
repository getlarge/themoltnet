package main

import (
	"bytes"
	"crypto/ed25519"
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

type capturedRegistrationRequest struct {
	CredentialType string `json:"credentialType"`
	Proof          string `json:"proof"`
	PublicKey      string `json:"publicKey"`
}

func assertRegistrationProof(t *testing.T, request *http.Request, body capturedRegistrationRequest, message string) {
	t.Helper()
	nonce := request.Header.Get("Idempotency-Key")
	if len(nonce) != 43 {
		t.Fatalf("idempotency key length = %d, want 43", len(nonce))
	}
	publicKey, err := ParsePublicKey(body.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	proof, err := base64.StdEncoding.DecodeString(body.Proof)
	if err != nil {
		t.Fatal(err)
	}
	if !ed25519.Verify(publicKey, []byte(message), proof) {
		t.Fatal("registration proof did not verify")
	}
}

func TestDoRegisterSelfOAuth2(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/auth/register" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		var body capturedRegistrationRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		nonce := r.Header.Get("Idempotency-Key")
		assertRegistrationProof(t, r, body, buildSelfRegistrationMessage(nonce, body.PublicKey, body.CredentialType))
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"agentId":     "00000000-0000-4000-a000-000000000123",
			"identityId":  "00000000-0000-0000-0000-000000000123",
			"fingerprint": "ABCD-1234-EF56-7890", "publicKey": body.PublicKey,
			"credential": map[string]any{"type": "oauth2", "clientId": "client-id", "clientSecret": "client-secret"},
		})
	}))
	defer server.Close()

	result, err := DoRegister(server.URL, credentialTypeOAuth2)
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	if result.Response.Credential.ClientID != "client-id" {
		t.Fatalf("client ID = %q", result.Response.Credential.ClientID)
	}
	if result.Response.SubjectID != "00000000-0000-4000-a000-000000000123" {
		t.Fatalf("subject ID = %q", result.Response.SubjectID)
	}
	if result.Response.SubjectType != SubjectTypeAgent {
		t.Fatalf("subject type = %q", result.Response.SubjectType)
	}
}

func TestDoRegisterSelfAgentKey(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/auth/register" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		var body capturedRegistrationRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		nonce := r.Header.Get("Idempotency-Key")
		assertRegistrationProof(t, r, body, buildSelfRegistrationMessage(nonce, body.PublicKey, body.CredentialType))
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"agentId":     "00000000-0000-4000-a000-000000000123",
			"identityId":  "00000000-0000-0000-0000-000000000123",
			"fingerprint": "ABCD-1234-EF56-7890",
			"publicKey":   body.PublicKey,
			"credential": map[string]any{
				"type":   "agent_key",
				"secret": "secret",
				"key": map[string]any{
					"id":                    "key-1",
					"agentId":               "00000000-0000-0000-0000-000000000123",
					"bindingScope":          "identity",
					"name":                  "Bootstrap credential",
					"status":                "active",
					"scopes":                []string{},
					"createdAt":             nil,
					"expiresAt":             nil,
					"lastUsedAt":            nil,
					"updatedAt":             nil,
					"revocationReason":      nil,
					"revocationDescription": nil,
				},
			},
		})
	}))
	defer server.Close()

	result, err := DoRegister(server.URL, credentialTypeAgentKey)
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	if result.Response.Credential.AgentKey != "secret" {
		t.Fatalf("agent key = %q", result.Response.Credential.AgentKey)
	}
}

func TestDoRegisterErrors(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/problem+json")
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"type":"urn:moltnet:problem:registration-failed","title":"Registration Failed","status":403}`))
	}))
	defer server.Close()
	if _, err := DoRegister(server.URL, credentialTypeOAuth2); err == nil {
		t.Fatal("expected HTTP error")
	}
	if _, err := DoRegister("http://127.0.0.1:1", credentialTypeOAuth2); err == nil {
		t.Fatal("expected network error")
	}
	if _, err := DoRegister(server.URL, "password"); err == nil {
		t.Fatal("expected credential type validation error")
	}
}

func TestReportRegistrationStoredPublishesAliasBestEffort(t *testing.T) {
	const mcpNotice = "MCP config not written"
	tests := []struct {
		name        string
		unreachable bool
		noMCP       bool
		wantStderr  []string
		wantAbsent  []string
	}{
		{
			name:       "publication succeeds",
			wantStderr: []string{"Published network alias reg-agent", mcpNotice},
		},
		{
			name:        "publication failure still completes registration",
			unreachable: true,
			wantStderr: []string{
				"Warning: network alias publication failed",
				"Recover with: moltnet config identity publish reg-agent",
				mcpNotice,
			},
		},
		{
			name:       "no MCP notice when disabled",
			noMCP:      true,
			wantStderr: []string{"Published network alias reg-agent"},
			wantAbsent: []string{mcpNotice},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Arrange
			f := newPublishFixture(t, "reg-agent")
			apiURL := f.server.URL
			if tt.unreachable {
				apiURL = "http://127.0.0.1:1"
			}
			var stderr bytes.Buffer

			// Act
			reportRegistrationStored(&stderr, apiURL, f.path, "reg-agent", tt.noMCP)

			// Assert
			for _, want := range tt.wantStderr {
				if !strings.Contains(stderr.String(), want) {
					t.Fatalf("stderr missing %q:\n%s", want, stderr.String())
				}
			}
			for _, absent := range tt.wantAbsent {
				if strings.Contains(stderr.String(), absent) {
					t.Fatalf("stderr unexpectedly contains %q:\n%s", absent, stderr.String())
				}
			}
		})
	}
}

// newRegisterTestServer answers /auth/register with a fixed OAuth2 credential
// and 404 for everything else, so alias publication fails softly and the test
// exercises the local persistence path only.
func newRegisterTestServer(t *testing.T, status int) (*httptest.Server, *atomic.Int32) {
	t.Helper()
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/auth/register" {
			http.NotFound(w, r)
			return
		}
		calls.Add(1)
		var body capturedRegistrationRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if status != http.StatusOK {
			w.Header().Set("Content-Type", "application/problem+json")
			w.WriteHeader(status)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"type": "https://themolt.net/problems/invalid-proof", "title": "rejected", "status": status,
			})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"agentId":     "00000000-0000-4000-a000-000000000123",
			"identityId":  "00000000-0000-0000-0000-000000000123",
			"fingerprint": "ABCD-1234-EF56-7890", "publicKey": body.PublicKey,
			"credential": map[string]any{"type": "oauth2", "clientId": "client-id", "clientSecret": "client-secret"},
		})
	}))
	t.Cleanup(server.Close)
	return server, &calls
}

// flakySecretProvider stores in memory and fails Set for one exact key.
type flakySecretProvider struct {
	values  map[string]string
	failKey string
}

func (p *flakySecretProvider) Get(key string) (string, error) {
	value, ok := p.values[key]
	if !ok {
		return "", ErrSecretNotFound
	}
	return value, nil
}

func (p *flakySecretProvider) Set(key, value string) error {
	if key == p.failKey {
		return errors.New("simulated store failure")
	}
	if p.values == nil {
		p.values = map[string]string{}
	}
	p.values[key] = value
	return nil
}

func (p *flakySecretProvider) Delete(key string) error {
	delete(p.values, key)
	return nil
}

func (p *flakySecretProvider) CanWrite() bool { return true }

func TestRegisterStoresSeedAndSecretAsReferences(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv(secretRootEnv, t.TempDir())
	t.Setenv(secretRootWritableEnv, "1")
	server, calls := newRegisterTestServer(t, http.StatusOK)

	root := NewRootCmd("test", "")
	_, stderr, err := executeCommand(root, "register", "--name", "reg-test", "--api-url", server.URL, "--destination", fileProviderName)
	if err != nil {
		t.Fatalf("register: %v\nstderr: %s", err, stderr)
	}
	if calls.Load() != 1 {
		t.Fatalf("registration calls = %d, want 1", calls.Load())
	}

	path, err := identityCredentialsPath("reg-test")
	if err != nil {
		t.Fatal(err)
	}
	creds, err := ReadConfigFrom(path)
	if err != nil {
		t.Fatalf("read config: %v", err)
	}
	if creds.SubjectID != "00000000-0000-4000-a000-000000000123" || creds.SubjectType != SubjectTypeAgent {
		t.Fatalf("subject = %q/%q", creds.SubjectID, creds.SubjectType)
	}
	if creds.Keys.PrivateKey != "" || creds.Keys.PrivateKeyRef == nil ||
		creds.Keys.PrivateKeyRef.Provider != fileProviderName ||
		creds.Keys.PrivateKeyRef.Key != IdentitySeedKey(creds.Keys.Fingerprint) {
		t.Fatalf("seed was not stored as a reference: %#v", creds.Keys)
	}
	if creds.OAuth2.ClientSecret != "" || creds.OAuth2.ClientSecretRef == nil ||
		creds.OAuth2.ClientSecretRef.Provider != fileProviderName ||
		creds.OAuth2.ClientSecretRef.Key != OAuth2SecretKey(creds.SubjectID, "client-id") {
		t.Fatalf("OAuth2 secret was not stored as a reference: %#v", creds.OAuth2)
	}
	registry := NewSecretProviderRegistry()
	seed, err := registry.Resolve(*creds.Keys.PrivateKeyRef)
	if err != nil {
		t.Fatalf("resolve seed: %v", err)
	}
	if err := assertSeedMatchesPublicKey(seed, creds.Keys.PublicKey); err != nil {
		t.Fatalf("stored seed does not match public key: %v", err)
	}
	if secret, err := registry.Resolve(*creds.OAuth2.ClientSecretRef); err != nil || secret != "client-secret" {
		t.Fatalf("resolve OAuth2 secret = %q, %v", secret, err)
	}
	selector, err := readIdentitySelector()
	if err != nil || selector == nil || selector.DefaultIdentity != "reg-test" {
		t.Fatalf("selector = %#v, %v; want default reg-test", selector, err)
	}
	if strings.Contains(stderr, "client-secret") {
		t.Fatal("OAuth2 secret leaked to stderr")
	}
}

func TestRegisterRejectedRegistrationRemovesSeed(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	secretRoot := t.TempDir()
	t.Setenv(secretRootEnv, secretRoot)
	t.Setenv(secretRootWritableEnv, "1")
	server, _ := newRegisterTestServer(t, http.StatusBadRequest)

	root := NewRootCmd("test", "")
	_, _, err := executeCommand(root, "register", "--name", "reg-rejected", "--api-url", server.URL, "--destination", fileProviderName)
	if err == nil {
		t.Fatal("expected registration to fail")
	}

	path, err := identityCredentialsPath("reg-rejected")
	if err != nil {
		t.Fatal(err)
	}
	if _, statErr := os.Stat(path); !os.IsNotExist(statErr) {
		t.Fatalf("config must not exist after a rejected registration: %v", statErr)
	}
	// The file provider keeps its directory layout; only stored values matter.
	var leftover []string
	walkErr := filepath.WalkDir(secretRoot, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !entry.IsDir() {
			leftover = append(leftover, path)
		}
		return nil
	})
	if walkErr != nil {
		t.Fatal(walkErr)
	}
	if len(leftover) != 0 {
		t.Fatalf("secret root should hold no values after cleanup, found %v", leftover)
	}
}

func TestRegisterKeepsIdentityRecoverableWhenSecretStoreFails(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	server, _ := newRegisterTestServer(t, http.StatusOK)
	provider := &flakySecretProvider{failKey: OAuth2SecretKey("00000000-0000-4000-a000-000000000123", "client-id")}
	registry := NewSecretProviderRegistry()
	registry.Register("flaky", provider)
	var stderr bytes.Buffer

	err := runRegister(registerOpts{
		stdout: &bytes.Buffer{}, errOut: &stderr,
		apiURL: server.URL, credentialType: credentialTypeOAuth2, name: "reg-flaky",
		destination: "flaky", secretProviders: registry,
	})

	if err == nil || !strings.Contains(err.Error(), "moltnet agents credentials recover --yes") {
		t.Fatalf("error = %v, want recovery guidance", err)
	}
	path, pathErr := identityCredentialsPath("reg-flaky")
	if pathErr != nil {
		t.Fatal(pathErr)
	}
	creds, readErr := ReadConfigFrom(path)
	if readErr != nil {
		t.Fatalf("config must survive a secret store failure: %v", readErr)
	}
	if creds.Keys.PrivateKeyRef == nil || creds.OAuth2.ClientSecretRef == nil || creds.OAuth2.ClientID != "client-id" {
		t.Fatalf("config is missing the references recovery needs: %#v", creds)
	}
	if _, seedErr := provider.Get(creds.Keys.PrivateKeyRef.Key); seedErr != nil {
		t.Fatalf("seed must remain stored: %v", seedErr)
	}
}

func TestRegisterRefusesExistingAlias(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv(secretRootEnv, t.TempDir())
	t.Setenv(secretRootWritableEnv, "1")
	server, calls := newRegisterTestServer(t, http.StatusOK)
	path, err := identityCredentialsPath("reg-dup")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := WriteConfigTo(&CredentialsFile{SubjectID: "existing", SubjectType: SubjectTypeAgent}, path); err != nil {
		t.Fatal(err)
	}

	root := NewRootCmd("test", "")
	_, _, err = executeCommand(root, "register", "--name", "reg-dup", "--api-url", server.URL, "--destination", fileProviderName)

	if err == nil || !strings.Contains(err.Error(), "already exists") {
		t.Fatalf("error = %v, want existing-alias refusal", err)
	}
	if calls.Load() != 0 {
		t.Fatalf("registration calls = %d, want 0", calls.Load())
	}
}
