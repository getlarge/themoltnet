package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	moltnetapi "github.com/getlarge/themoltnet/cmd/moltnet-api-client"
	"github.com/google/uuid"
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
type noopSecurityHandler struct{}

func (noopSecurityHandler) HandleBearerAuth(_ context.Context, _ moltnetapi.OperationName, _ moltnetapi.BearerAuth) (context.Context, error) {
	return context.Background(), nil
}

// TestTokenSecuritySource verifies that GetToken is called and the Bearer header is set.
func TestTokenSecuritySource(t *testing.T) {
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
	src := &tokenSecuritySource{tm: tm}

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
}

// TestTokenSecuritySourceCached verifies that the token is cached on the second call.
func TestTokenSecuritySourceCached(t *testing.T) {
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
	src := &tokenSecuritySource{tm: tm}

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
		Fingerprint: "A1B2-C3D4-E5F6-A1B2",
		PublicKey:   "ed25519:pk-abc",
		ClientId:    "client-xyz",
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
