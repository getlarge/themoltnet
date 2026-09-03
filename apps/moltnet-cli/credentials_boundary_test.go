package main

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

// Issue #2129 was reported against the released CLI, so its regression
// coverage has to run through the real command tree — root flags, cobra
// wiring, generated API client and all — not only the resolver helpers
// exercised in credentials_discovery_test.go. Each test here stands up a
// global and an activated credentials file pointing at different servers and
// asserts on what the server actually received.

// recordingAPI is a stand-in MoltNet API that records the OAuth2 client_id it
// was asked to authenticate, so a test can prove which credentials file a
// command actually used.
type recordingAPI struct {
	server      *httptest.Server
	mu          sync.Mutex
	clientIDs   []string
	authHeaders []string
	requests    int
}

func newRecordingAPI(t *testing.T) *recordingAPI {
	t.Helper()
	api := &recordingAPI{}
	mux := http.NewServeMux()
	mux.HandleFunc("/oauth2/token", func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		api.mu.Lock()
		api.clientIDs = append(api.clientIDs, r.Form.Get("client_id"))
		api.requests++
		api.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"token","token_type":"bearer","expires_in":3600}`))
	})
	mux.HandleFunc("/agents/whoami", func(w http.ResponseWriter, r *http.Request) {
		api.mu.Lock()
		api.requests++
		api.authHeaders = append(api.authHeaders, r.Header.Get("Authorization"))
		api.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"identityId":"00000000-0000-0000-0000-000000000000","subjectType":"agent","scopes":[]}`))
	})
	api.server = httptest.NewServer(mux)
	t.Cleanup(api.server.Close)
	return api
}

func (a *recordingAPI) snapshot() (int, []string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.requests, append([]string(nil), a.clientIDs...)
}

func (a *recordingAPI) authorizations() []string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return append([]string(nil), a.authHeaders...)
}

// TestAgentsWhoamiUsesActivatedCredentialsAndEndpoint exercises the released
// command boundary — not just the resolver helper — with no --credentials and
// no --api-url. Both the endpoint and the OAuth2 identity must come from the
// activated config.
func TestAgentsWhoamiUsesActivatedCredentialsAndEndpoint(t *testing.T) {
	globalAPI := newRecordingAPI(t)
	activatedAPI := newRecordingAPI(t)

	home := t.TempDir()
	agentDir := filepath.Join(home, "repo", ".moltnet", "agent")
	gitConfigPath := filepath.Join(agentDir, "gitconfig")
	global := newIdentityFixture(t, "global", globalAPI.server.URL)
	activated := newIdentityFixture(t, "activated", activatedAPI.server.URL)
	writeIdentityConfig(t, filepath.Join(home, ".config", "moltnet", "moltnet.json"), global)
	writeIdentityConfig(t, filepath.Join(agentDir, "moltnet.json"), activated)
	if err := os.WriteFile(gitConfigPath, []byte("[user]\n\tname = agent\n"), 0o600); err != nil {
		t.Fatalf("write gitconfig: %v", err)
	}

	t.Setenv("HOME", home)
	t.Setenv("MOLTNET_CREDENTIALS_PATH", "")
	t.Setenv("GIT_CONFIG_GLOBAL", gitConfigPath)
	t.Setenv(apiURLEnv, "")
	t.Setenv(agentKeyEnv, "")
	t.Setenv(agentKeyRefEnv, "")

	root := NewRootCmd("test", "")
	if _, _, err := executeCommand(root, "agents", "whoami"); err != nil {
		t.Fatalf("agents whoami: %v", err)
	}

	globalRequests, _ := globalAPI.snapshot()
	if globalRequests != 0 {
		t.Errorf("global endpoint received %d requests, want 0", globalRequests)
	}
	activatedRequests, clientIDs := activatedAPI.snapshot()
	if activatedRequests == 0 {
		t.Fatal("activated endpoint received no requests")
	}
	for _, id := range clientIDs {
		if id != activated.clientID {
			t.Errorf("authenticated as client_id %q, want %q", id, activated.clientID)
		}
	}
}

// signingAPI is a stand-in MoltNet API for the one-shot `sign --request-id`
// flow. It serves one pending agent-ed25519 request and captures the signature
// the CLI submits, so a test can check which private key actually signed.
type signingAPI struct {
	server      *httptest.Server
	requestID   string
	signedBytes []byte

	mu        sync.Mutex
	submitted string
}

func newSigningAPI(t *testing.T) *signingAPI {
	t.Helper()
	api := &signingAPI{
		requestID:   "66666666-6666-4666-8666-666666666666",
		signedBytes: []byte("bytes the agent must sign"),
	}
	body := `{
		"agentId":"44444444-4444-4444-8444-444444444444",
		"challenge":null,"claimedAt":null,"claimedByHumanId":null,"completedAt":null,
		"createdAt":"2026-01-01T00:00:00Z","expiresAt":"2030-01-01T00:00:00Z",
		"id":"` + api.requestID + `","message":"message",
		"nonce":"55555555-5555-4555-8555-555555555555",
		"purpose":null,"receipt":null,"rejectedAt":null,"rejectionReason":null,
		"requestedBy":null,"signature":null,"signerConstraint":null,
		"signingCredentialId":null,
		"signingInput":"` + base64.StdEncoding.EncodeToString(api.signedBytes) + `",
		"status":"pending","teamId":null,"valid":null,
		"verificationMethod":"agent-ed25519"
	}`

	mux := http.NewServeMux()
	mux.HandleFunc("/oauth2/token", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"token","token_type":"bearer","expires_in":3600}`))
	})
	mux.HandleFunc("/crypto/signing-requests/"+api.requestID+"/sign", func(w http.ResponseWriter, r *http.Request) {
		var payload struct {
			Signature string `json:"signature"`
		}
		_ = json.NewDecoder(r.Body).Decode(&payload)
		api.mu.Lock()
		api.submitted = payload.Signature
		api.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(body))
	})
	mux.HandleFunc("/crypto/signing-requests/"+api.requestID, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(body))
	})
	api.server = httptest.NewServer(mux)
	t.Cleanup(api.server.Close)
	return api
}

func (a *signingAPI) submittedSignature() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.submitted
}

// mustPublicKey decodes the "ed25519:<base64>" public key of a fixture.
func mustPublicKey(t *testing.T, fixture identityFixture) ed25519.PublicKey {
	t.Helper()
	raw, err := base64.StdEncoding.DecodeString(
		strings.TrimPrefix(fixture.publicKey, "ed25519:"),
	)
	if err != nil {
		t.Fatalf("decode public key: %v", err)
	}
	return ed25519.PublicKey(raw)
}

// TestSignRequestIDUsesActivatedSigner is the regression test for the reported
// incident: with no --credentials, `moltnet sign --request-id` signed with the
// global agent's key while the shell was activated for a repository agent. The
// assertion is on the submitted signature, so it fails if either the wrong key
// signs or the wrong endpoint is contacted.
func TestSignRequestIDUsesActivatedSigner(t *testing.T) {
	api := newSigningAPI(t)

	home := t.TempDir()
	agentDir := filepath.Join(home, "repo", ".moltnet", "agent")
	gitConfigPath := filepath.Join(agentDir, "gitconfig")
	global := newIdentityFixture(t, "global", api.server.URL)
	activated := newIdentityFixture(t, "activated", api.server.URL)
	writeIdentityConfig(t, filepath.Join(home, ".config", "moltnet", "moltnet.json"), global)
	writeIdentityConfig(t, filepath.Join(agentDir, "moltnet.json"), activated)
	if err := os.WriteFile(gitConfigPath, []byte("[user]\n\tname = agent\n"), 0o600); err != nil {
		t.Fatalf("write gitconfig: %v", err)
	}

	t.Setenv("HOME", home)
	t.Setenv("MOLTNET_CREDENTIALS_PATH", "")
	t.Setenv("GIT_CONFIG_GLOBAL", gitConfigPath)
	t.Setenv(apiURLEnv, "")
	t.Setenv(agentKeyEnv, "")
	t.Setenv(agentKeyRefEnv, "")
	t.Setenv(signerURLEnv, "")

	root := NewRootCmd("test", "")
	if _, _, err := executeCommand(root, "sign", "--request-id", api.requestID); err != nil {
		t.Fatalf("sign --request-id: %v", err)
	}

	sig, err := base64.StdEncoding.DecodeString(api.submittedSignature())
	if err != nil {
		t.Fatalf("decode submitted signature %q: %v", api.submittedSignature(), err)
	}
	if !ed25519.Verify(mustPublicKey(t, activated), api.signedBytes, sig) {
		t.Error("submitted signature does not verify against the activated agent key")
	}
	if ed25519.Verify(mustPublicKey(t, global), api.signedBytes, sig) {
		t.Error("submitted signature verifies against the global agent key")
	}
}

// TestEnvironmentAgentKeyGoesToActivatedEndpoint covers the credential-leak
// half of issue #2129. MOLTNET_AGENT_KEY authenticates without reading any
// credentials file, so the endpoint resolution is the only thing standing
// between the key and the wrong host: before the fix, endpoint discovery fell
// back to the global config while the shell was activated elsewhere.
func TestEnvironmentAgentKeyGoesToActivatedEndpoint(t *testing.T) {
	globalAPI := newRecordingAPI(t)
	activatedAPI := newRecordingAPI(t)

	home := t.TempDir()
	agentDir := filepath.Join(home, "repo", ".moltnet", "agent")
	gitConfigPath := filepath.Join(agentDir, "gitconfig")
	writeIdentityConfig(
		t,
		filepath.Join(home, ".config", "moltnet", "moltnet.json"),
		newIdentityFixture(t, "global", globalAPI.server.URL),
	)
	writeIdentityConfig(
		t,
		filepath.Join(agentDir, "moltnet.json"),
		newIdentityFixture(t, "activated", activatedAPI.server.URL),
	)
	if err := os.WriteFile(gitConfigPath, []byte("[user]\n\tname = agent\n"), 0o600); err != nil {
		t.Fatalf("write gitconfig: %v", err)
	}

	t.Setenv("HOME", home)
	t.Setenv("MOLTNET_CREDENTIALS_PATH", "")
	t.Setenv("GIT_CONFIG_GLOBAL", gitConfigPath)
	t.Setenv(apiURLEnv, "")
	t.Setenv(agentKeyRefEnv, "")
	t.Setenv(agentKeyEnv, "agent-key-secret")

	root := NewRootCmd("test", "")
	if _, _, err := executeCommand(root, "agents", "whoami"); err != nil {
		t.Fatalf("agents whoami: %v", err)
	}

	if globalRequests, _ := globalAPI.snapshot(); globalRequests != 0 {
		t.Errorf("global endpoint received %d requests, want 0", globalRequests)
	}
	authorizations := activatedAPI.authorizations()
	if len(authorizations) == 0 {
		t.Fatal("activated endpoint received no requests")
	}
	for _, header := range authorizations {
		if header != "Bearer agent-key-secret" {
			t.Errorf("Authorization = %q, want the environment agent key", header)
		}
	}
}
