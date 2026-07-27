package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

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
	client, err := newAuthedClient(apiSrv.URL, tm)
	if err != nil {
		t.Fatalf("newAuthedClient: %v", err)
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

// TestNewAuthedClientCallsAPI is an integration smoke-test using the generated server stub.
func TestNewAuthedClientCallsAPI(t *testing.T) {
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
	_ = time.Now() // ensure time import used
}

func TestNewAuthenticatedClientUsesStandaloneAgentKey(t *testing.T) {
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
