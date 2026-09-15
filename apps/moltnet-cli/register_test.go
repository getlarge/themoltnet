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

const (
	registerTestAgentID    = "00000000-0000-4000-a000-000000000123"
	registerTestIdentityID = "00000000-0000-0000-0000-000000000123"
	registerTestClientID   = "client-id"
	registerTestSecret     = "client-secret"
)

type capturedRegistrationRequest struct {
	CredentialType string `json:"credentialType"`
	Proof          string `json:"proof"`
	PublicKey      string `json:"publicKey"`
}

// registerServerConfig shapes the one fake registration endpoint every test
// in this file uses. Zero values answer 200 with an OAuth2 credential.
type registerServerConfig struct {
	// status, when non-200, answers with a problem document instead.
	status int
	// credential replaces the default OAuth2 credential in a 200 response.
	credential map[string]any
	// verifyProof checks the Ed25519 proof over the self-registration message.
	verifyProof bool
	// onRequest runs before the response is written, for ordering assertions.
	onRequest func(body capturedRegistrationRequest)
}

// newRegisterTestServer answers /auth/register and 404s everything else, so
// alias publication fails softly and tests exercise registration only.
func newRegisterTestServer(t *testing.T, cfg registerServerConfig) (*httptest.Server, *atomic.Int32) {
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
			// t.Fatal would not stop the test from this goroutine.
			t.Errorf("decode registration request: %v", err)
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		if cfg.verifyProof {
			nonce := r.Header.Get("Idempotency-Key")
			assertRegistrationProof(t, r, body, buildSelfRegistrationMessage(nonce, body.PublicKey, body.CredentialType))
		}
		if cfg.onRequest != nil {
			cfg.onRequest(body)
		}
		if cfg.status != 0 && cfg.status != http.StatusOK {
			// The REST API sends problem+json only to clients that ask for it;
			// the generated Go client does not, so it decodes application/json.
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(cfg.status)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"type": "https://themolt.net/problems/registration-failed", "title": "Registration failed", "status": cfg.status,
				"code": "REGISTRATION_FAILED",
			})
			return
		}
		credential := cfg.credential
		if credential == nil {
			credential = map[string]any{"type": "oauth2", "clientId": registerTestClientID, "clientSecret": registerTestSecret}
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"agentId": registerTestAgentID, "identityId": registerTestIdentityID,
			"fingerprint": "ABCD-1234-EF56-7890", "publicKey": body.PublicKey,
			"credential": credential,
		})
	}))
	t.Cleanup(server.Close)
	return server, &calls
}

func assertRegistrationProof(t *testing.T, request *http.Request, body capturedRegistrationRequest, message string) {
	t.Helper()
	if nonce := request.Header.Get("Idempotency-Key"); len(nonce) != 43 {
		t.Errorf("idempotency key length = %d, want 43", len(nonce))
		return
	}
	publicKey, err := ParsePublicKey(body.PublicKey)
	if err != nil {
		t.Errorf("parse public key: %v", err)
		return
	}
	proof, err := base64.StdEncoding.DecodeString(body.Proof)
	if err != nil {
		t.Errorf("decode proof: %v", err)
		return
	}
	if !ed25519.Verify(publicKey, []byte(message), proof) {
		t.Error("registration proof did not verify")
	}
}

// registerMemoryRegistry returns a registry whose OS keyring is in memory,
// plus a flag that flips when an identity seed is stored. The flag is atomic
// so the fake server can read it from its own goroutine.
func registerMemoryRegistry() (*SecretProviderRegistry, *memorySecretProvider, *atomic.Bool) {
	registry, memory := newMemorySecretProviderRegistry()
	var seedStored atomic.Bool
	memory.failSet = func(key string) error {
		if isIdentitySeedKey(key) {
			seedStored.Store(true)
		}
		return nil
	}
	return registry, memory, &seedStored
}

// seedKeyFingerprint parses a seed key by round-tripping its fingerprint
// through IdentitySeedKey, so a change to the production key format cannot
// make the seed assertions in these tests pass vacuously.
func seedKeyFingerprint(key string) (string, bool) {
	const marker = "\x00"
	prefix, suffix, _ := strings.Cut(IdentitySeedKey(marker), marker)
	fingerprint, ok := strings.CutPrefix(key, prefix)
	if !ok {
		return "", false
	}
	fingerprint, ok = strings.CutSuffix(fingerprint, suffix)
	if !ok || fingerprint == "" || IdentitySeedKey(fingerprint) != key {
		return "", false
	}
	return fingerprint, true
}

func isIdentitySeedKey(key string) bool {
	_, ok := seedKeyFingerprint(key)
	return ok
}

func storedSeedKeys(memory *memorySecretProvider) []string {
	var keys []string
	for key := range memory.values {
		if isIdentitySeedKey(key) {
			keys = append(keys, key)
		}
	}
	return keys
}

func isPreflightKey(key string) bool {
	return strings.HasPrefix(key, "preflight/")
}

// failSetFor makes a memory provider reject writes to the keys fails matches.
func failSetFor(fails func(key string) bool) func(key string) error {
	return func(key string) error {
		if fails(key) {
			return errors.New("simulated store failure")
		}
		return nil
	}
}

func TestIsIdentitySeedKeyFollowsTheProductionFormat(t *testing.T) {
	tests := []struct {
		key  string
		want bool
	}{
		{key: IdentitySeedKey("ABCD-1234-EF56-7890"), want: true},
		{key: IdentitySeedKey(""), want: false},
		{key: OAuth2SecretKey(registerTestAgentID, registerTestClientID), want: false},
		{key: "preflight/1/2", want: false},
	}
	for _, tt := range tests {
		if got := isIdentitySeedKey(tt.key); got != tt.want {
			t.Errorf("isIdentitySeedKey(%q) = %v, want %v", tt.key, got, tt.want)
		}
	}
	if fingerprint, _ := seedKeyFingerprint(IdentitySeedKey("ABCD-1234-EF56-7890")); fingerprint != "ABCD-1234-EF56-7890" {
		t.Errorf("seedKeyFingerprint round trip = %q", fingerprint)
	}
}

func runTestRegister(t *testing.T, apiURL, name string, registry *SecretProviderRegistry) (string, error) {
	t.Helper()
	var stderr bytes.Buffer
	err := runRegister(registerOpts{
		stdout: &bytes.Buffer{}, errOut: &stderr,
		apiURL: apiURL, credentialType: credentialTypeOAuth2, name: name,
		secretProviders: registry,
	})
	return stderr.String(), err
}

func TestDoRegisterSelfOAuth2(t *testing.T) {
	server, _ := newRegisterTestServer(t, registerServerConfig{verifyProof: true})

	result, err := DoRegister(server.URL, credentialTypeOAuth2)

	if err != nil {
		t.Fatalf("register: %v", err)
	}
	if result.Response.Credential.ClientID != registerTestClientID {
		t.Fatalf("client ID = %q", result.Response.Credential.ClientID)
	}
	if result.Response.SubjectID != registerTestAgentID || result.Response.SubjectType != SubjectTypeAgent {
		t.Fatalf("subject = %q/%q", result.Response.SubjectID, result.Response.SubjectType)
	}
}

func TestDoRegisterSelfAgentKey(t *testing.T) {
	server, _ := newRegisterTestServer(t, registerServerConfig{
		verifyProof: true,
		credential: map[string]any{
			"type":   "agent_key",
			"secret": "secret",
			"key": map[string]any{
				"id": "key-1", "agentId": registerTestIdentityID, "bindingScope": "identity",
				"name": "Bootstrap credential", "status": "active", "scopes": []string{},
				"createdAt": nil, "expiresAt": nil, "lastUsedAt": nil, "updatedAt": nil,
				"revocationReason": nil, "revocationDescription": nil,
			},
		},
	})

	result, err := DoRegister(server.URL, credentialTypeAgentKey)

	if err != nil {
		t.Fatalf("register: %v", err)
	}
	if result.Response.Credential.AgentKey != "secret" {
		t.Fatalf("agent key = %q", result.Response.Credential.AgentKey)
	}
}

func TestDoRegisterErrors(t *testing.T) {
	server, _ := newRegisterTestServer(t, registerServerConfig{status: http.StatusForbidden})

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

func TestDoRegisterWithKeyPairGuards(t *testing.T) {
	server, calls := newRegisterTestServer(t, registerServerConfig{})
	keyPair, err := GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name           string
		credentialType string
		keyPair        *KeyPair
		wantErr        string
	}{
		{name: "nil keypair", credentialType: credentialTypeOAuth2, wantErr: "requires a generated keypair"},
		{name: "unknown credential type", credentialType: "password", keyPair: keyPair, wantErr: "oauth2 or agent_key"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := DoRegisterWithKeyPair(server.URL, tt.credentialType, tt.keyPair)

			if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("error = %v, want containing %q", err, tt.wantErr)
			}
		})
	}
	if calls.Load() != 0 {
		t.Fatalf("registration calls = %d, want 0", calls.Load())
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

func TestRegisterStoresSeedAndSecretAsReferences(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv(secretRootEnv, t.TempDir())
	t.Setenv(secretRootWritableEnv, "1")
	server, calls := newRegisterTestServer(t, registerServerConfig{})

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
	if creds.SubjectID != registerTestAgentID || creds.SubjectType != SubjectTypeAgent {
		t.Fatalf("subject = %q/%q", creds.SubjectID, creds.SubjectType)
	}
	if creds.Keys.PrivateKey != "" || creds.Keys.PrivateKeyRef == nil ||
		creds.Keys.PrivateKeyRef.Provider != fileProviderName ||
		creds.Keys.PrivateKeyRef.Key != IdentitySeedKey(creds.Keys.Fingerprint) {
		t.Fatalf("seed was not stored as a reference: %#v", creds.Keys)
	}
	if creds.OAuth2.ClientSecret != "" || creds.OAuth2.ClientSecretRef == nil ||
		creds.OAuth2.ClientSecretRef.Provider != fileProviderName ||
		creds.OAuth2.ClientSecretRef.Key != OAuth2SecretKey(creds.SubjectID, registerTestClientID) {
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
	if secret, err := registry.Resolve(*creds.OAuth2.ClientSecretRef); err != nil || secret != registerTestSecret {
		t.Fatalf("resolve OAuth2 secret = %q, %v", secret, err)
	}
	selector, err := readIdentitySelector()
	if err != nil || selector == nil || selector.DefaultIdentity != "reg-test" {
		t.Fatalf("selector = %#v, %v; want default reg-test", selector, err)
	}
	if strings.Contains(stderr, registerTestSecret) {
		t.Fatal("OAuth2 secret leaked to stderr")
	}
}

func TestRegisterPointsAtTheNextOnboardingStep(t *testing.T) {
	// Arrange
	t.Setenv("HOME", t.TempDir())
	registry, _ := newMemorySecretProviderRegistry()
	server, _ := newRegisterTestServer(t, registerServerConfig{})
	var stdout, stderr bytes.Buffer

	// Act
	err := runRegister(registerOpts{
		stdout: &stdout, errOut: &stderr,
		apiURL: server.URL, credentialType: credentialTypeOAuth2, name: "reg-next",
		secretProviders: registry,
	})

	// Assert
	if err != nil {
		t.Fatalf("register: %v\nstderr: %s", err, stderr.String())
	}
	for _, want := range []string{
		"reg-next now has its own identity and keys, separate from your account.",
		"Next, give it a job: " + firstTaskDocsURL,
	} {
		if !strings.Contains(stderr.String(), want) {
			t.Fatalf("stderr missing %q:\n%s", want, stderr.String())
		}
	}
	if firstTaskDocsURL != "https://docs.themolt.net/start/first-task" {
		t.Fatalf("firstTaskDocsURL = %q", firstTaskDocsURL)
	}
	if stdout.Len() != 0 {
		t.Fatalf("stdout must stay empty, got %q", stdout.String())
	}
}

func TestRegisterStoresSeedBeforeRegisteringInTheDefaultProvider(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	registry, memory, seedStored := registerMemoryRegistry()
	var seedStoredBeforeRequest atomic.Bool
	server, _ := newRegisterTestServer(t, registerServerConfig{
		onRequest: func(capturedRegistrationRequest) {
			seedStoredBeforeRequest.Store(seedStored.Load())
		},
	})

	// No destination: the default resolves to the OS keyring, here in memory.
	stderr, err := runTestRegister(t, server.URL, "reg-default", registry)

	if err != nil {
		t.Fatalf("register: %v\nstderr: %s", err, stderr)
	}
	if !seedStoredBeforeRequest.Load() {
		t.Fatal("the identity seed must be stored before the registration request")
	}
	path, err := identityCredentialsPath("reg-default")
	if err != nil {
		t.Fatal(err)
	}
	creds, err := ReadConfigFrom(path)
	if err != nil {
		t.Fatal(err)
	}
	if creds.Keys.PrivateKeyRef == nil || creds.Keys.PrivateKeyRef.Provider != osKeyringProviderName ||
		creds.OAuth2.ClientSecretRef == nil || creds.OAuth2.ClientSecretRef.Provider != osKeyringProviderName {
		t.Fatalf("default destination is not the OS keyring: %#v / %#v", creds.Keys.PrivateKeyRef, creds.OAuth2.ClientSecretRef)
	}
	for key := range memory.values {
		if strings.HasPrefix(key, "preflight/") {
			t.Fatalf("the preflight probe left %s behind", key)
		}
	}
}

func TestRegisterKeepsTheSeedWhenRegistrationDoesNotComplete(t *testing.T) {
	const (
		rejected = "The server rejected the registration, so no agent was created"
		unclear  = "The server may have registered this identity"
	)
	tests := []struct {
		name    string
		cfg     registerServerConfig
		want    string
		notWant string
	}{
		{name: "definitive rejection", cfg: registerServerConfig{status: http.StatusBadRequest}, want: rejected, notWant: unclear},
		{name: "registration already in progress", cfg: registerServerConfig{status: http.StatusConflict}, want: unclear, notWant: rejected},
		{name: "server error that may follow a commit", cfg: registerServerConfig{status: http.StatusServiceUnavailable}, want: unclear, notWant: rejected},
		{name: "committed but undecodable credential", cfg: registerServerConfig{credential: map[string]any{"type": "unknown"}}, want: unclear, notWant: rejected},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("HOME", t.TempDir())
			registry, memory, _ := registerMemoryRegistry()
			server, _ := newRegisterTestServer(t, tt.cfg)

			stderr, err := runTestRegister(t, server.URL, "reg-incomplete", registry)

			if err == nil {
				t.Fatal("expected registration to fail")
			}
			if strings.Contains(stderr, firstTaskDocsURL) || strings.Contains(err.Error(), firstTaskDocsURL) {
				t.Fatalf("an incomplete registration must not point at the next step:\n%s", stderr)
			}
			seeds := storedSeedKeys(memory)
			if len(seeds) != 1 {
				t.Fatalf("stored seeds = %v, want exactly the one kept seed", seeds)
			}
			if !strings.Contains(err.Error(), "seed kept at os-keyring:"+seeds[0]) {
				t.Fatalf("error does not name the kept seed %s: %v", seeds[0], err)
			}
			if !strings.Contains(err.Error(), tt.want) || strings.Contains(err.Error(), tt.notWant) {
				t.Fatalf("error = %v, want %q and not %q", err, tt.want, tt.notWant)
			}
			if tt.want == unclear {
				fingerprint, _ := seedKeyFingerprint(seeds[0])
				for _, hint := range []string{server.URL + "/agents/" + fingerprint, "generates a new keypair"} {
					if !strings.Contains(err.Error(), hint) {
						t.Fatalf("error lacks %q: %v", hint, err)
					}
				}
			}
			path, pathErr := identityCredentialsPath("reg-incomplete")
			if pathErr != nil {
				t.Fatal(pathErr)
			}
			if _, statErr := os.Stat(path); !os.IsNotExist(statErr) {
				t.Fatalf("config must not exist when registration did not complete: %v", statErr)
			}
		})
	}
}

func TestRegisterStopsBeforeTheNetworkWhenSecretsCannotBeStored(t *testing.T) {
	tests := []struct {
		name    string
		fails   func(key string) bool
		wantErr string
	}{
		{name: "provider preflight fails", fails: isPreflightKey, wantErr: "is unavailable"},
		{name: "seed store fails", fails: isIdentitySeedKey, wantErr: "store identity seed"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("HOME", t.TempDir())
			registry, memory := newMemorySecretProviderRegistry()
			memory.failSet = failSetFor(tt.fails)
			server, calls := newRegisterTestServer(t, registerServerConfig{})

			_, err := runTestRegister(t, server.URL, "reg-no-store", registry)

			if err == nil || !strings.Contains(err.Error(), tt.wantErr) || !strings.Contains(err.Error(), "registration was not attempted") {
				t.Fatalf("error = %v, want %q before any network call", err, tt.wantErr)
			}
			if calls.Load() != 0 {
				t.Fatalf("registration calls = %d, want 0", calls.Load())
			}
			if seeds := storedSeedKeys(memory); len(seeds) != 0 {
				t.Fatalf("stored seeds = %v, want none", seeds)
			}
		})
	}
}

func TestRegisterNamesTheKeptSeedWhenAnotherIdentityClaimedTheAlias(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	registry, memory, _ := registerMemoryRegistry()
	path, err := identityCredentialsPath("reg-race")
	if err != nil {
		t.Fatal(err)
	}
	winner := &CredentialsFile{SubjectID: "concurrent-winner", SubjectType: SubjectTypeAgent}
	// A concurrent `register --name reg-race` lands its config while this run
	// is registering remotely.
	server, _ := newRegisterTestServer(t, registerServerConfig{
		onRequest: func(capturedRegistrationRequest) {
			if _, err := WriteConfigTo(winner, path); err != nil {
				t.Errorf("write concurrent config: %v", err)
			}
		},
	})

	_, err = runTestRegister(t, server.URL, "reg-race", registry)

	if err == nil || !strings.Contains(err.Error(), `identity "reg-race" was created by another command`) {
		t.Fatalf("error = %v, want the race named", err)
	}
	if strings.Contains(err.Error(), "move") {
		t.Fatalf("the race must not advise moving the winner's config aside: %v", err)
	}
	seeds := storedSeedKeys(memory)
	if len(seeds) != 1 || !strings.Contains(err.Error(), seeds[0]) || !strings.Contains(err.Error(), registerTestAgentID) {
		t.Fatalf("error must name the registered agent and kept seed %v: %v", seeds, err)
	}
	creds, readErr := ReadConfigFrom(path)
	if readErr != nil {
		t.Fatal(readErr)
	}
	if creds.SubjectID != "concurrent-winner" {
		t.Fatalf("the concurrent identity config was overwritten: %#v", creds)
	}
}

func TestRegisterKeepsIdentityRecoverableWhenSecretStoreFails(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	registry, memory := newMemorySecretProviderRegistry()
	oauth2Key := OAuth2SecretKey(registerTestAgentID, registerTestClientID)
	memory.failSet = func(key string) error {
		if key == oauth2Key {
			return errors.New("simulated store failure")
		}
		return nil
	}
	server, _ := newRegisterTestServer(t, registerServerConfig{})

	stderr, err := runTestRegister(t, server.URL, "reg-flaky", registry)

	if err == nil || !strings.Contains(err.Error(), "moltnet agents credentials recover --yes") {
		t.Fatalf("error = %v, want recovery guidance", err)
	}
	if strings.Contains(stderr, firstTaskDocsURL) {
		t.Fatalf("a partly stored identity must not point at the next step:\n%s", stderr)
	}
	path, pathErr := identityCredentialsPath("reg-flaky")
	if pathErr != nil {
		t.Fatal(pathErr)
	}
	creds, readErr := ReadConfigFrom(path)
	if readErr != nil {
		t.Fatalf("config must survive a secret store failure: %v", readErr)
	}
	if creds.Keys.PrivateKeyRef == nil || creds.OAuth2.ClientSecretRef == nil || creds.OAuth2.ClientID != registerTestClientID {
		t.Fatalf("config is missing the references recovery needs: %#v", creds)
	}
	if memory.values[creds.Keys.PrivateKeyRef.Key] == "" {
		t.Fatal("seed must remain stored")
	}
}

func TestRegisterWarnsWhenTheDefaultIdentityCannotBeSelected(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	selectorPath, err := identitySelectorPath()
	if err != nil {
		t.Fatal(err)
	}
	// A directory where the selector file belongs makes the selector write fail.
	if err := os.MkdirAll(selectorPath, 0o700); err != nil {
		t.Fatal(err)
	}
	registry, _ := newMemorySecretProviderRegistry()
	server, _ := newRegisterTestServer(t, registerServerConfig{})

	stderr, err := runTestRegister(t, server.URL, "reg-no-selector", registry)

	if err != nil {
		t.Fatalf("a selector failure must not fail registration: %v", err)
	}
	if !strings.Contains(stderr, "was not selected as the default identity") ||
		!strings.Contains(stderr, "moltnet config identity select reg-no-selector") {
		t.Fatalf("stderr lacks the selector warning:\n%s", stderr)
	}
	path, pathErr := identityCredentialsPath("reg-no-selector")
	if pathErr != nil {
		t.Fatal(pathErr)
	}
	if _, statErr := os.Stat(path); statErr != nil {
		t.Fatalf("config must be written: %v", statErr)
	}
}

func TestRegisterRefusesExistingAlias(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	registry, memory := newMemorySecretProviderRegistry()
	server, calls := newRegisterTestServer(t, registerServerConfig{})
	path, err := identityCredentialsPath("reg-dup")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := WriteConfigTo(&CredentialsFile{SubjectID: "existing", SubjectType: SubjectTypeAgent}, path); err != nil {
		t.Fatal(err)
	}

	_, err = runTestRegister(t, server.URL, "reg-dup", registry)

	if !errors.Is(err, errIdentityExists) || !strings.Contains(err.Error(), "move "+filepath.Dir(path)+" aside") {
		t.Fatalf("error = %v, want existing-alias refusal with a way to reuse the name", err)
	}
	if calls.Load() != 0 {
		t.Fatalf("registration calls = %d, want 0", calls.Load())
	}
	if seeds := storedSeedKeys(memory); len(seeds) != 0 {
		t.Fatalf("stored seeds = %v, want none for a refused alias", seeds)
	}
}

func TestRegisterJSONPrintsCredentialsAndWritesNothing(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	registry, memory := newMemorySecretProviderRegistry()
	server, _ := newRegisterTestServer(t, registerServerConfig{})
	var stdout bytes.Buffer

	var stderr bytes.Buffer

	err := runRegister(registerOpts{
		stdout: &stdout, errOut: &stderr,
		apiURL: server.URL, credentialType: credentialTypeOAuth2,
		jsonOut: true, secretProviders: registry,
	})

	if err != nil {
		t.Fatalf("register --json: %v", err)
	}
	if strings.Contains(stdout.String()+stderr.String(), firstTaskDocsURL) {
		t.Fatalf("--json must not print the next step:\nstdout: %s\nstderr: %s", stdout.String(), stderr.String())
	}
	decoder := json.NewDecoder(bytes.NewReader(stdout.Bytes()))
	var whole map[string]any
	if err := decoder.Decode(&whole); err != nil {
		t.Fatalf("stdout is not JSON: %v\n%s", err, stdout.String())
	}
	if decoder.More() {
		t.Fatalf("stdout has content after the JSON document:\n%s", stdout.String())
	}
	var printed map[string]any
	if err := json.Unmarshal(stdout.Bytes(), &printed); err != nil {
		t.Fatalf("stdout is not JSON: %v\n%s", err, stdout.String())
	}
	if printed["subject_id"] != registerTestAgentID || printed["private_key"] == "" {
		t.Fatalf("unexpected JSON output: %v", printed)
	}
	if len(memory.values) != 0 {
		t.Fatalf("--json must not store secrets, found %v", memory.values)
	}
	if aliases, err := listIdentityAliases(); err != nil || len(aliases) != 0 {
		t.Fatalf("--json must not write an identity, found %v (%v)", aliases, err)
	}
}
