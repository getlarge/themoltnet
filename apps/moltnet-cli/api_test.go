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
	isolateCredentialDiscovery(t)

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

func TestNewAuthenticatedClientPrefersEnvironmentAgentKeyOverOAuth(t *testing.T) {
	t.Setenv(agentKeyEnv, "explicit-agent-key")

	wantID := uuid.MustParse("00000000-0000-0000-0000-000000000006")
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
		t.Fatalf("GetWhoami() transport error: %v", err)
	}
	if tokenCalls != 0 {
		t.Errorf("OAuth token calls = %d, want 0", tokenCalls)
	}
	if authorization != "Bearer explicit-agent-key" {
		t.Errorf("Authorization = %q, want explicit agent-key bearer", authorization)
	}
}

func TestNewAuthenticatedClientDoesNotFallBackAfterExplicitAgentKeyRejection(t *testing.T) {
	t.Setenv(agentKeyEnv, "rejected-agent-key")
	t.Setenv(agentKeyRefEnv, "")
	tokenCalls := 0
	var authorization string
	apiSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/oauth2/token" {
			tokenCalls++
		}
		authorization = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"type":"about:blank","title":"Unauthorized","status":401,"code":"UNAUTHORIZED"}`))
	}))
	defer apiSrv.Close()

	client, err := newAuthenticatedClient(apiSrv.URL, writeCredsWithAPI(t, apiSrv.URL))
	if err != nil {
		t.Fatalf("newAuthenticatedClient() error: %v", err)
	}
	res, err := client.GetWhoami(context.Background())
	if err != nil {
		t.Fatalf("GetWhoami() transport error: %v", err)
	}
	if _, ok := res.(*moltnetapi.GetWhoamiUnauthorized); !ok {
		t.Fatalf("response = %T, want unauthorized", res)
	}
	if tokenCalls != 0 || authorization != "Bearer rejected-agent-key" {
		t.Fatalf("tokenCalls = %d, Authorization = %q; want rejected explicit key with no OAuth fallback", tokenCalls, authorization)
	}
}

func TestNewAuthenticatedClientNeverFallsBackWhenOAuthConfigurationIsIncomplete(t *testing.T) {
	t.Setenv(agentKeyEnv, "")
	t.Setenv(agentKeyRefEnv, "")
	credPath := filepath.Join(t.TempDir(), "moltnet.json")
	creds := &CredentialsFile{
		SubjectID: "id-1",
		OAuth2:    CredentialsOAuth2{ClientID: "oauth-client"},
		Endpoints: CredentialsEndpoints{API: "https://api.example.test"},
	}
	if _, err := WriteConfigTo(creds, credPath); err != nil {
		t.Fatal(err)
	}

	_, err := newAuthenticatedClient("https://api.example.test", credPath)
	if err == nil || !strings.Contains(err.Error(), "oauth2 config must set exactly one") {
		t.Fatalf("expected OAuth2 configuration error, got %v", err)
	}
}

func TestNewAuthenticatedClientNeverFallsBackFromMalformedCredentials(t *testing.T) {
	t.Setenv(agentKeyEnv, "")
	t.Setenv(agentKeyRefEnv, "")
	credPath := filepath.Join(t.TempDir(), "moltnet.json")
	if err := os.WriteFile(credPath, []byte("{not-json"), 0o600); err != nil {
		t.Fatal(err)
	}

	_, err := newAuthenticatedClient("https://api.example.test", credPath)
	if err == nil || !strings.Contains(err.Error(), "parse config") {
		t.Fatalf("expected selected credentials error, got %v", err)
	}
}

func TestNewAuthenticatedClientExplicitAgentKeyDoesNotReadMalformedCredentials(t *testing.T) {
	t.Setenv(agentKeyEnv, "explicit-agent-key")
	t.Setenv(agentKeyRefEnv, "")
	credPath := filepath.Join(t.TempDir(), "moltnet.json")
	if err := os.WriteFile(credPath, []byte("{not-json"), 0o600); err != nil {
		t.Fatal(err)
	}

	client, err := newAuthenticatedClient("https://api.example.test", credPath)
	if err != nil {
		t.Fatalf("explicit agent key should bypass selected credentials: %v", err)
	}
	if client == nil {
		t.Fatal("newAuthenticatedClient() returned nil client")
	}
}

func TestValidateCredentialAPIURL(t *testing.T) {
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
			err := validateCredentialAPIURL(tt.apiURL)
			if (err != nil) != tt.wantErr {
				t.Errorf("validateCredentialAPIURL(%q) error = %v, wantErr %v", tt.apiURL, err, tt.wantErr)
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
	if !strings.Contains(err.Error(), "use HTTPS") {
		t.Errorf("error = %q, want agent-key HTTPS diagnostic", err)
	}
}

func TestNewAuthenticatedClientRejectsInsecureRemoteOAuthEndpoint(t *testing.T) {
	t.Setenv(agentKeyEnv, "")
	t.Setenv(agentKeyRefEnv, "")
	credPath := filepath.Join(t.TempDir(), "moltnet.json")
	creds := &CredentialsFile{
		OAuth2: CredentialsOAuth2{ClientID: "client", ClientSecret: "secret"},
	}
	if _, err := WriteConfigTo(creds, credPath); err != nil {
		t.Fatal(err)
	}

	_, err := newAuthenticatedClient("http://api.example.com", credPath)
	if err == nil || !strings.Contains(err.Error(), "use HTTPS") {
		t.Fatalf("expected OAuth2 HTTPS diagnostic, got %v", err)
	}
}

func TestNewAuthenticatedClientMissingOAuthCredentialsNamesAgentKeyOption(t *testing.T) {
	isolateIdentityEnv(t)
	t.Setenv(agentKeyEnv, "")
	isolateCredentialDiscovery(t)

	_, err := newAuthenticatedClient(defaultAPIURL, "")
	if err == nil {
		t.Fatal("expected missing credentials error")
	}
	// With an empty central store the remedy is to create or migrate an
	// identity — NOT `config identity select`, which would also fail.
	if !strings.Contains(err.Error(), agentKeyEnv) ||
		!strings.Contains(err.Error(), "moltnet register") ||
		!strings.Contains(err.Error(), "config migrate") {
		t.Errorf("error = %q, want the agent-key option and an empty-store remedy", err)
	}
}

func TestNewAuthenticatedClientResolvesAgentKeyReference(t *testing.T) {
	t.Setenv(agentKeyEnv, "")
	t.Setenv(agentKeyRefEnv, "env:MOLTNET_TEST_AGENT_KEY")
	t.Setenv("MOLTNET_TEST_AGENT_KEY", "ak_from_ref")
	isolateCredentialDiscovery(t)
	generated, err := moltnetapi.NewServer(
		&stubWhoamiHandler{identityID: uuid.MustParse("00000000-0000-0000-0000-000000000004")},
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

	client, err := newAuthenticatedClient(apiSrv.URL, writeCredsWithAPI(t, apiSrv.URL))
	if err != nil {
		t.Fatalf("newAuthenticatedClient() error: %v", err)
	}
	if _, err := client.GetWhoami(context.Background()); err != nil {
		t.Fatalf("GetWhoami() error: %v", err)
	}
	if authorization != "Bearer ak_from_ref" {
		t.Errorf("Authorization = %q, want the resolved agent key", authorization)
	}
	if tokenCalls != 0 {
		t.Errorf("OAuth token calls = %d, want 0", tokenCalls)
	}
}

func TestNewAuthenticatedClientRejectsAgentKeyValueAndReferenceTogether(t *testing.T) {
	t.Setenv(agentKeyEnv, "ak")
	t.Setenv(agentKeyRefEnv, "env:X")
	if _, err := newAuthenticatedClient("https://api.example.test", ""); err == nil || !strings.Contains(err.Error(), "set only one of") {
		t.Fatalf("expected both-set error, got %v", err)
	}
}

func TestNewAuthenticatedClientPrefersOAuthOverConfigAgentKeyReference(t *testing.T) {
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
	credPath := filepath.Join(t.TempDir(), "moltnet.json")
	creds := &CredentialsFile{
		SubjectID:   "id-1",
		AgentKeyRef: &SecretReference{Provider: fileProviderName, Key: "agent-key.other"},
		OAuth2:      CredentialsOAuth2{ClientID: "c", ClientSecret: "s"},
		Endpoints:   CredentialsEndpoints{API: apiSrv.URL},
	}
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
	if authorization != "Bearer oauth-access-token" || tokenCalls != 1 {
		t.Fatalf("Authorization = %q, tokenCalls = %d; want OAuth2 and no agent-key resolution", authorization, tokenCalls)
	}
}

func TestNewAuthenticatedClientDoesNotFallBackAfterConfigOAuthRejection(t *testing.T) {
	t.Setenv(agentKeyEnv, "")
	t.Setenv(agentKeyRefEnv, "")
	root := t.TempDir()
	t.Setenv(secretRootEnv, root)
	if err := os.WriteFile(filepath.Join(root, "agent-key.id-1"), []byte("fallback-key\n"), 0o400); err != nil {
		t.Fatal(err)
	}
	tokenCalls := 0
	var authorizations []string
	apiSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/oauth2/token" {
			tokenCalls++
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"access_token":"rejected-oauth-token","token_type":"Bearer","expires_in":3600}`))
			return
		}
		authorizations = append(authorizations, r.Header.Get("Authorization"))
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"type":"about:blank","title":"Unauthorized","status":401,"code":"UNAUTHORIZED"}`))
	}))
	defer apiSrv.Close()
	credPath := filepath.Join(t.TempDir(), "moltnet.json")
	creds := &CredentialsFile{
		SubjectID:   "id-1",
		AgentKeyRef: &SecretReference{Provider: fileProviderName, Key: "agent-key.id-1"},
		OAuth2:      CredentialsOAuth2{ClientID: "client", ClientSecret: "secret"},
	}
	if _, err := WriteConfigTo(creds, credPath); err != nil {
		t.Fatal(err)
	}

	client, err := newAuthenticatedClient(apiSrv.URL, credPath)
	if err != nil {
		t.Fatal(err)
	}
	res, err := client.GetWhoami(context.Background())
	if err != nil {
		t.Fatalf("GetWhoami() transport error: %v", err)
	}
	if _, ok := res.(*moltnetapi.GetWhoamiUnauthorized); !ok {
		t.Fatalf("response = %T, want unauthorized", res)
	}
	if tokenCalls != 1 || len(authorizations) != 1 || authorizations[0] != "Bearer rejected-oauth-token" {
		t.Fatalf("tokenCalls = %d, authorizations = %v; want one rejected OAuth attempt and no key fallback", tokenCalls, authorizations)
	}
}

func TestNewAuthenticatedClientDoesNotFallBackFromUnresolvableOAuthReference(t *testing.T) {
	t.Setenv(agentKeyEnv, "")
	t.Setenv(agentKeyRefEnv, "")
	root := t.TempDir()
	t.Setenv(secretRootEnv, root)
	if err := os.WriteFile(filepath.Join(root, "agent-key.id-1"), []byte("usable-key\n"), 0o400); err != nil {
		t.Fatal(err)
	}
	credPath := filepath.Join(t.TempDir(), "moltnet.json")
	creds := &CredentialsFile{
		SubjectID:   "id-1",
		AgentKeyRef: &SecretReference{Provider: fileProviderName, Key: "agent-key.id-1"},
		OAuth2: CredentialsOAuth2{
			ClientID:        "client",
			ClientSecretRef: &SecretReference{Provider: fileProviderName, Key: "missing-oauth-secret"},
		},
	}
	if _, err := WriteConfigTo(creds, credPath); err != nil {
		t.Fatal(err)
	}

	_, err := newAuthenticatedClient("https://api.example.test", credPath)
	if err == nil || !strings.Contains(err.Error(), "agent_key_ref was not attempted") {
		t.Fatalf("expected selected OAuth2 resolution failure, got %v", err)
	}
}

func TestNewAuthenticatedClientDoesNotFallBackFromMissingOAuthClientID(t *testing.T) {
	t.Setenv(agentKeyEnv, "")
	t.Setenv(agentKeyRefEnv, "")
	root := t.TempDir()
	t.Setenv(secretRootEnv, root)
	if err := os.WriteFile(filepath.Join(root, "agent-key.id-1"), []byte("usable-key\n"), 0o400); err != nil {
		t.Fatal(err)
	}
	credPath := filepath.Join(t.TempDir(), "moltnet.json")
	creds := &CredentialsFile{
		SubjectID:   "id-1",
		AgentKeyRef: &SecretReference{Provider: fileProviderName, Key: "agent-key.id-1"},
		OAuth2:      CredentialsOAuth2{ClientSecret: "secret-without-client-id"},
	}
	if _, err := WriteConfigTo(creds, credPath); err != nil {
		t.Fatal(err)
	}

	_, err := newAuthenticatedClient("https://api.example.test", credPath)
	if err == nil || !strings.Contains(err.Error(), "missing client_id") ||
		!strings.Contains(err.Error(), "agent_key_ref was not attempted") {
		t.Fatalf("expected selected OAuth2 validation failure, got %v", err)
	}
}
