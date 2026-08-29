package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	moltnetapi "github.com/getlarge/themoltnet/libs/moltnet-api-client"
	"github.com/google/uuid"
	"github.com/ogen-go/ogen/ogenerrors"
)

// newTestServer builds a token stub and an ogen-generated API server backed by
// the given handler, returning both httptest servers and a ready Client.
func newTestServer(t *testing.T, h moltnetapi.Handler) (*httptest.Server, *httptest.Server, *moltnetapi.Client) {
	t.Helper()

	tokenSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{ //nolint:errcheck
			"access_token": "test-token",
			"token_type":   "Bearer",
			"expires_in":   3600,
		})
	}))

	// The generated server needs a SecurityHandler even for client-side tests;
	// use a no-op that always accepts.
	apiSrv_gen, err := moltnetapi.NewServer(h, noopSecurityHandler{})
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}
	apiSrv := httptest.NewServer(apiSrv_gen)

	tm := NewTokenManager(tokenSrv.URL, "cid", "csec")
	client, err := newBearerClient(
		apiSrv.URL,
		func(_ context.Context) (string, error) {
			return tm.GetToken()
		},
		tm.httpClient,
	)
	if err != nil {
		t.Fatalf("newBearerClient: %v", err)
	}

	t.Cleanup(func() {
		tokenSrv.Close()
		apiSrv.Close()
	})

	return tokenSrv, apiSrv, client
}

// noopSecurityHandler accepts all bearer tokens for test servers.
// CookieAuth / SessionAuth methods exist to satisfy the generated
// SecurityHandler interface — the CLI never exercises those paths, so they
// also accept unconditionally.
type noopSecurityHandler struct{}

func (noopSecurityHandler) HandleBearerAuth(_ context.Context, _ moltnetapi.OperationName, _ moltnetapi.BearerAuth) (context.Context, error) {
	return context.Background(), nil
}

func (noopSecurityHandler) HandleCookieAuth(_ context.Context, _ moltnetapi.OperationName, _ moltnetapi.CookieAuth) (context.Context, error) {
	return context.Background(), nil
}

func (noopSecurityHandler) HandleSessionAuth(_ context.Context, _ moltnetapi.OperationName, _ moltnetapi.SessionAuth) (context.Context, error) {
	return context.Background(), nil
}

// TestBearerSecuritySource verifies that OAuth token resolution is lazy and
// the resulting access token is exposed through the bearer scheme only.
func TestBearerSecuritySource(t *testing.T) {
	called := false
	tokenSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{ //nolint:errcheck
			"access_token": "injected-token",
			"token_type":   "Bearer",
			"expires_in":   3600,
		})
	}))
	defer tokenSrv.Close()

	tm := NewTokenManager(tokenSrv.URL, "cid", "csec")
	src := &bearerSecuritySource{
		token: func(_ context.Context) (string, error) {
			return tm.GetToken()
		},
	}

	bearer, err := src.BearerAuth(context.Background(), moltnetapi.GetWhoamiOperation)
	if err != nil {
		t.Fatalf("BearerAuth() error: %v", err)
	}
	if bearer.Token != "injected-token" {
		t.Errorf("expected token=injected-token, got %q", bearer.Token)
	}
	if !called {
		t.Error("expected token server to be called")
	}
	if _, err := src.CookieAuth(context.Background(), moltnetapi.GetWhoamiOperation); err != ogenerrors.ErrSkipClientSecurity {
		t.Errorf("CookieAuth() error = %v, want ErrSkipClientSecurity", err)
	}
	if _, err := src.SessionAuth(context.Background(), moltnetapi.GetWhoamiOperation); err != ogenerrors.ErrSkipClientSecurity {
		t.Errorf("SessionAuth() error = %v, want ErrSkipClientSecurity", err)
	}
}

// TestBearerSecuritySourceCachesOAuthToken verifies that the TokenManager still
// caches OAuth access tokens behind the shared bearer adapter.
func TestBearerSecuritySourceCachesOAuthToken(t *testing.T) {
	callCount := 0
	tokenSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{ //nolint:errcheck
			"access_token": "cached-token",
			"token_type":   "Bearer",
			"expires_in":   3600,
		})
	}))
	defer tokenSrv.Close()

	tm := NewTokenManager(tokenSrv.URL, "cid", "csec")
	src := &bearerSecuritySource{
		token: func(_ context.Context) (string, error) {
			return tm.GetToken()
		},
	}

	for i := 0; i < 3; i++ {
		if _, err := src.BearerAuth(context.Background(), moltnetapi.GetWhoamiOperation); err != nil {
			t.Fatalf("BearerAuth() call %d error: %v", i, err)
		}
	}
	if callCount != 1 {
		t.Errorf("expected token server called once (cached), got %d", callCount)
	}
}

// stubWhoamiHandler returns a fixed Whoami response.
type stubWhoamiHandler struct {
	moltnetapi.UnimplementedHandler
	identityID uuid.UUID
}

func (h *stubWhoamiHandler) GetWhoami(_ context.Context) (moltnetapi.GetWhoamiRes, error) {
	return &moltnetapi.Whoami{
		IdentityId:  h.identityID,
		SubjectType: moltnetapi.WhoamiSubjectTypeAgent,
		Fingerprint: moltnetapi.NewOptString("A1B2-C3D4-E5F6-A1B2"),
		PublicKey:   moltnetapi.NewOptString("ed25519:pk-abc"),
		ClientId:    moltnetapi.NewOptString("client-xyz"),
	}, nil
}

// TestNewBearerClientCallsAPI is an integration smoke-test using the generated server stub.
func TestNewBearerClientCallsAPI(t *testing.T) {
	wantID := uuid.MustParse("00000000-0000-0000-0000-000000000001")
	_, _, client := newTestServer(t, &stubWhoamiHandler{identityID: wantID})

	res, err := client.GetWhoami(context.Background())
	if err != nil {
		t.Fatalf("GetWhoami() error: %v", err)
	}
	whoami, ok := res.(*moltnetapi.Whoami)
	if !ok {
		t.Fatalf("expected *Whoami, got %T", res)
	}
	if whoami.IdentityId != wantID {
		t.Errorf("expected identity_id=%s, got %s", wantID, whoami.IdentityId)
	}
}

func TestNewAuthenticatedClientUsesStandaloneAgentKey(t *testing.T) {
	// Agent-key secrets never contain surrounding whitespace. Normalizing here
	// makes command substitution from a newline-terminated secret file safe and
	// matches the SDK's environment handling.
	t.Setenv(agentKeyEnv, "  opaque-agent-key  ")
	t.Setenv("HOME", t.TempDir())

	wantID := uuid.MustParse("00000000-0000-0000-0000-000000000002")
	generated, err := moltnetapi.NewServer(
		&stubWhoamiHandler{identityID: wantID},
		noopSecurityHandler{},
	)
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}

	var authorization string
	apiSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authorization = r.Header.Get("Authorization")
		generated.ServeHTTP(w, r)
	}))
	defer apiSrv.Close()

	client, err := newAuthenticatedClient(
		apiSrv.URL,
		filepath.Join(t.TempDir(), "missing-moltnet.json"),
	)
	if err != nil {
		t.Fatalf("newAuthenticatedClient() error: %v", err)
	}
	res, err := client.GetWhoami(context.Background())
	if err != nil {
		t.Fatalf("GetWhoami() error: %v", err)
	}
	if _, ok := res.(*moltnetapi.Whoami); !ok {
		t.Fatalf("expected *Whoami, got %T", res)
	}
	if authorization != "Bearer opaque-agent-key" {
		t.Errorf("Authorization = %q, want static agent-key bearer", authorization)
	}
}

func TestNewAuthenticatedClientBlankAgentKeyFallsBackToOAuth(t *testing.T) {
	t.Setenv(agentKeyEnv, "   ")

	wantID := uuid.MustParse("00000000-0000-0000-0000-000000000003")
	generated, err := moltnetapi.NewServer(
		&stubWhoamiHandler{identityID: wantID},
		noopSecurityHandler{},
	)
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}

	tokenCalls := 0
	var authorization string
	apiSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/oauth2/token" {
			tokenCalls++
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{ //nolint:errcheck
				"access_token": "oauth-access-token",
				"token_type":   "Bearer",
				"expires_in":   3600,
			})
			return
		}
		authorization = r.Header.Get("Authorization")
		generated.ServeHTTP(w, r)
	}))
	defer apiSrv.Close()

	credPath := writeCredsWithAPI(t, apiSrv.URL)
	client, err := newAuthenticatedClient(apiSrv.URL, credPath)
	if err != nil {
		t.Fatalf("newAuthenticatedClient() error: %v", err)
	}
	if _, err := client.GetWhoami(context.Background()); err != nil {
		t.Fatalf("GetWhoami() error: %v", err)
	}
	if tokenCalls != 1 {
		t.Errorf("OAuth token calls = %d, want 1", tokenCalls)
	}
	if authorization != "Bearer oauth-access-token" {
		t.Errorf("Authorization = %q, want OAuth bearer", authorization)
	}
}

func TestNewAuthenticatedClientRejectedAgentKeyNeverFallsBackToOAuth(t *testing.T) {
	t.Setenv(agentKeyEnv, "rejected-agent-key")

	tokenCalls := 0
	var authorization string
	apiSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/oauth2/token" {
			tokenCalls++
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{ //nolint:errcheck
				"access_token": "oauth-access-token",
				"token_type":   "Bearer",
				"expires_in":   3600,
			})
			return
		}
		authorization = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]any{ //nolint:errcheck
			"type":   "about:blank",
			"title":  "Unauthorized",
			"status": http.StatusUnauthorized,
			"code":   "UNAUTHORIZED",
		})
	}))
	defer apiSrv.Close()

	credPath := writeCredsWithAPI(t, apiSrv.URL)
	client, err := newAuthenticatedClient(apiSrv.URL, credPath)
	if err != nil {
		t.Fatalf("newAuthenticatedClient() error: %v", err)
	}
	res, err := client.GetWhoami(context.Background())
	if err != nil {
		t.Fatalf("GetWhoami() transport error: %v", err)
	}
	if tokenCalls != 0 {
		t.Errorf("OAuth token calls = %d, want 0", tokenCalls)
	}
	if authorization != "Bearer rejected-agent-key" {
		t.Errorf("Authorization = %q, want authoritative agent key", authorization)
	}
	formatted := formatAPIError(res)
	if !strings.Contains(formatted.Error(), agentKeyEnv) ||
		!strings.Contains(formatted.Error(), "OAuth2 fallback is disabled") {
		t.Errorf("rejection error = %q, want agent-key mode diagnostic", formatted)
	}
}

func TestValidateAgentKeyAPIURL(t *testing.T) {
	tests := []struct {
		name    string
		apiURL  string
		wantErr bool
	}{
		{name: "https", apiURL: "https://api.example.com"},
		{name: "localhost http", apiURL: "http://localhost:8080"},
		{name: "IPv4 loopback http", apiURL: "http://127.0.0.2:8080"},
		{name: "IPv6 loopback http", apiURL: "http://[::1]:8080"},
		{name: "remote http", apiURL: "http://api.example.com", wantErr: true},
		{name: "relative URL", apiURL: "api.example.com", wantErr: true},
		{name: "unsupported scheme", apiURL: "ftp://api.example.com", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateAgentKeyAPIURL(tt.apiURL)
			if (err != nil) != tt.wantErr {
				t.Errorf("validateAgentKeyAPIURL(%q) error = %v, wantErr %v", tt.apiURL, err, tt.wantErr)
			}
		})
	}
}

func TestNewAuthenticatedClientRejectsInsecureRemoteAgentKeyEndpoint(t *testing.T) {
	t.Setenv(agentKeyEnv, "opaque-agent-key")

	_, err := newAuthenticatedClient(
		"http://api.example.com",
		filepath.Join(t.TempDir(), "missing-moltnet.json"),
	)
	if err == nil {
		t.Fatal("expected insecure endpoint error")
	}
	if !strings.Contains(err.Error(), "use HTTPS") ||
		!strings.Contains(err.Error(), agentKeyEnv) {
		t.Errorf("error = %q, want agent-key HTTPS diagnostic", err)
	}
}

func TestNewAuthenticatedClientMissingOAuthCredentialsNamesAgentKeyOption(t *testing.T) {
	t.Setenv(agentKeyEnv, "")
	t.Setenv("HOME", t.TempDir())

	_, err := newAuthenticatedClient(defaultAPIURL, "")
	if err == nil {
		t.Fatal("expected missing credentials error")
	}
	if !strings.Contains(err.Error(), agentKeyEnv) ||
		!strings.Contains(err.Error(), "moltnet register") {
		t.Errorf("error = %q, want both authentication options", err)
	}
}

func TestNewAuthenticatedClientResolvesAgentKeyReference(t *testing.T) {
	t.Setenv(agentKeyEnv, "")
	t.Setenv(agentKeyRefEnv, "env:MOLTNET_TEST_AGENT_KEY")
	t.Setenv("MOLTNET_TEST_AGENT_KEY", "ak_from_ref")
	t.Setenv("HOME", t.TempDir())
	generated, err := moltnetapi.NewServer(
		&stubWhoamiHandler{identityID: uuid.MustParse("00000000-0000-0000-0000-000000000004")},
		noopSecurityHandler{},
	)
	if err != nil {
		t.Fatal(err)
	}
	var authorization string
	apiSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authorization = r.Header.Get("Authorization")
		generated.ServeHTTP(w, r)
	}))
	defer apiSrv.Close()

	client, err := newAuthenticatedClient(apiSrv.URL, filepath.Join(t.TempDir(), "missing-moltnet.json"))
	if err != nil {
		t.Fatalf("newAuthenticatedClient() error: %v", err)
	}
	if _, err := client.GetWhoami(context.Background()); err != nil {
		t.Fatalf("GetWhoami() error: %v", err)
	}
	if authorization != "Bearer ak_from_ref" {
		t.Errorf("Authorization = %q, want the resolved agent key", authorization)
	}
}

func TestNewAuthenticatedClientRejectsAgentKeyValueAndReferenceTogether(t *testing.T) {
	t.Setenv(agentKeyEnv, "ak")
	t.Setenv(agentKeyRefEnv, "env:X")
	if _, err := newAuthenticatedClient("https://api.example.test", ""); err == nil || !strings.Contains(err.Error(), "set only one of") {
		t.Fatalf("expected both-set error, got %v", err)
	}
}

func TestNewAuthenticatedClientUsesConfigAgentKeyReferenceBeforeOAuth(t *testing.T) {
	t.Setenv(agentKeyEnv, "")
	t.Setenv(agentKeyRefEnv, "")
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "agent-key.id-1"), []byte("ak_from_config\n"), 0o400); err != nil {
		t.Fatal(err)
	}
	t.Setenv(secretRootEnv, root)
	generated, err := moltnetapi.NewServer(
		&stubWhoamiHandler{identityID: uuid.MustParse("00000000-0000-0000-0000-000000000005")},
		noopSecurityHandler{},
	)
	if err != nil {
		t.Fatal(err)
	}
	tokenCalls := 0
	var authorization string
	apiSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/oauth2/token" {
			tokenCalls++
		}
		authorization = r.Header.Get("Authorization")
		generated.ServeHTTP(w, r)
	}))
	defer apiSrv.Close()
	credPath := filepath.Join(t.TempDir(), "moltnet.json")
	creds := &CredentialsFile{
		IdentityID:  "id-1",
		AgentKeyRef: &SecretReference{Provider: fileProviderName, Key: "agent-key.other"},
		OAuth2:      CredentialsOAuth2{ClientID: "c", ClientSecret: "s"},
		Endpoints:   CredentialsEndpoints{API: apiSrv.URL},
	}
	if _, err := WriteConfigTo(creds, credPath); err != nil {
		t.Fatal(err)
	}
	if _, err := newAuthenticatedClient(apiSrv.URL, credPath); err == nil || !strings.Contains(err.Error(), "not bound") {
		t.Fatalf("a reference bound to another identity must be rejected; got err=%v", err)
	}

	creds.AgentKeyRef = &SecretReference{Provider: fileProviderName, Key: "agent-key.id-1"}
	if _, err := WriteConfigTo(creds, credPath); err != nil {
		t.Fatal(err)
	}
	client, err := newAuthenticatedClient(apiSrv.URL, credPath)
	if err != nil {
		t.Fatalf("newAuthenticatedClient() error: %v", err)
	}
	if _, err := client.GetWhoami(context.Background()); err != nil {
		t.Fatalf("GetWhoami() error: %v", err)
	}
	if authorization != "Bearer ak_from_config" || tokenCalls != 0 {
		t.Fatalf("Authorization = %q, tokenCalls = %d; want the config agent key and no OAuth2 exchange", authorization, tokenCalls)
	}
}
