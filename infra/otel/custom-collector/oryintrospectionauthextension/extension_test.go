package oryintrospectionauthextension

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"go.opentelemetry.io/collector/client"
	"go.uber.org/zap/zaptest"
)

// newMockHydra returns an httptest.Server that behaves roughly like Hydra's
// introspection endpoint. The provided activeTokens map controls which
// bearer values the mock considers valid.
//
// Each call increments `callCount` so tests can assert on cache behavior.
func newMockHydra(
	t *testing.T,
	activeTokens map[string]introspectionResponse,
	expectedAuthHeader string, // empty = don't check
	callCount *int32,
) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		// Verify the extension is authenticating itself correctly when
		// a specific auth header is expected.
		if expectedAuthHeader != "" {
			if got := r.Header.Get("Authorization"); got != expectedAuthHeader {
				t.Errorf("expected introspection Authorization %q, got %q", expectedAuthHeader, got)
			}
		}
		if err := r.ParseForm(); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if callCount != nil {
			atomic.AddInt32(callCount, 1)
		}
		tok := r.FormValue("token")
		resp, ok := activeTokens[tok]
		if !ok {
			// Hydra returns 200 with active:false for unknown tokens.
			_ = json.NewEncoder(w).Encode(introspectionResponse{Active: false})
			return
		}
		resp.Active = true
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}))
}

func TestAuthenticate_HappyPath(t *testing.T) {
	var calls int32
	hydra := newMockHydra(t,
		map[string]introspectionResponse{
			"good-token": {
				Sub:      "agent-legreffier",
				ClientID: "client-xyz",
				Scope:    "telemetry:write profile",
			},
		}, "", &calls)
	defer hydra.Close()

	ext := newExtension(&Config{
		IntrospectionEndpoint: hydra.URL,
		RequiredScopes:        []string{"telemetry:write"},
		CacheTTL:              1 * time.Minute,
		CacheMaxEntries:       100,
	}, zaptest.NewLogger(t))

	ctx, err := ext.Authenticate(context.Background(), map[string][]string{
		"Authorization": {"Bearer good-token"},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Downstream processors read claims via client.FromContext.
	info := client.FromContext(ctx)
	if sub := info.Auth.GetAttribute("sub"); sub != "agent-legreffier" {
		t.Errorf("expected sub=agent-legreffier, got %v", sub)
	}
	if cid := info.Auth.GetAttribute("client_id"); cid != "client-xyz" {
		t.Errorf("expected client_id=client-xyz, got %v", cid)
	}
	if got := info.Metadata.Get("auth.subject"); len(got) != 1 || got[0] != "agent-legreffier" {
		t.Errorf("expected metadata auth.subject=[agent-legreffier], got %v", got)
	}
}

func TestAuthenticate_MissingScope(t *testing.T) {
	hydra := newMockHydra(t, map[string]introspectionResponse{
		"scoped-wrong": {
			Sub:   "agent-x",
			Scope: "read:diary",
		},
	}, "", nil)
	defer hydra.Close()

	ext := newExtension(&Config{
		IntrospectionEndpoint: hydra.URL,
		RequiredScopes:        []string{"telemetry:write"},
	}, zaptest.NewLogger(t))

	_, err := ext.Authenticate(context.Background(), map[string][]string{
		"Authorization": {"Bearer scoped-wrong"},
	})
	if err == nil || !strings.Contains(err.Error(), `scope "telemetry:write"`) {
		t.Fatalf("expected scope error, got %v", err)
	}
}

func TestAuthenticate_InactiveToken(t *testing.T) {
	hydra := newMockHydra(t, map[string]introspectionResponse{}, "", nil)
	defer hydra.Close()

	ext := newExtension(&Config{IntrospectionEndpoint: hydra.URL}, zaptest.NewLogger(t))
	_, err := ext.Authenticate(context.Background(), map[string][]string{
		"Authorization": {"Bearer revoked"},
	})
	if err == nil || !strings.Contains(err.Error(), "not active") {
		t.Fatalf("expected not-active error, got %v", err)
	}
}

func TestAuthenticate_MalformedHeader(t *testing.T) {
	ext := newExtension(&Config{IntrospectionEndpoint: "http://unused"}, zaptest.NewLogger(t))

	cases := []struct {
		name    string
		headers map[string][]string
		wantErr string
	}{
		{"missing", map[string][]string{}, "missing Authorization"},
		{"no scheme", map[string][]string{"Authorization": {"just-a-token"}}, "must be"},
		{"wrong scheme", map[string][]string{"Authorization": {"Basic abc"}}, "must be"},
		{"empty token", map[string][]string{"Authorization": {"Bearer "}}, "must be"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := ext.Authenticate(context.Background(), tc.headers)
			if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
				t.Errorf("expected error containing %q, got %v", tc.wantErr, err)
			}
		})
	}
}

func TestAuthenticate_CacheHit(t *testing.T) {
	var calls int32
	hydra := newMockHydra(t, map[string]introspectionResponse{
		"cached-token": {Sub: "agent-a", Scope: "telemetry:write"},
	}, "", &calls)
	defer hydra.Close()

	ext := newExtension(&Config{
		IntrospectionEndpoint: hydra.URL,
		CacheTTL:              1 * time.Minute,
		CacheMaxEntries:       100,
	}, zaptest.NewLogger(t))

	for i := 0; i < 5; i++ {
		_, err := ext.Authenticate(context.Background(), map[string][]string{
			"Authorization": {"Bearer cached-token"},
		})
		if err != nil {
			t.Fatalf("iter %d: %v", i, err)
		}
	}
	if got := atomic.LoadInt32(&calls); got != 1 {
		t.Errorf("expected 1 introspection call (4 cache hits), got %d", got)
	}
}

func TestAuthenticate_CacheExpires(t *testing.T) {
	var calls int32
	hydra := newMockHydra(t, map[string]introspectionResponse{
		"ttl-token": {Sub: "agent-b"},
	}, "", &calls)
	defer hydra.Close()

	ext := newExtension(&Config{
		IntrospectionEndpoint: hydra.URL,
		CacheTTL:              20 * time.Millisecond,
		CacheMaxEntries:       100,
	}, zaptest.NewLogger(t))

	_, _ = ext.Authenticate(context.Background(), map[string][]string{
		"Authorization": {"Bearer ttl-token"},
	})
	time.Sleep(50 * time.Millisecond)
	_, _ = ext.Authenticate(context.Background(), map[string][]string{
		"Authorization": {"Bearer ttl-token"},
	})
	if got := atomic.LoadInt32(&calls); got != 2 {
		t.Errorf("expected 2 introspection calls after TTL expiry, got %d", got)
	}
}

func TestAuthenticate_BearerIntrospectionAuth(t *testing.T) {
	hydra := newMockHydra(t,
		map[string]introspectionResponse{"t": {Sub: "a"}},
		"Bearer ory_pat_secret",
		nil,
	)
	defer hydra.Close()

	ext := newExtension(&Config{
		IntrospectionEndpoint: hydra.URL,
		IntrospectionAuth: IntrospectionAuthConfig{
			Type:  authTypeBearer,
			Token: "ory_pat_secret",
		},
	}, zaptest.NewLogger(t))

	if _, err := ext.Authenticate(context.Background(), map[string][]string{
		"Authorization": {"Bearer t"},
	}); err != nil {
		t.Fatalf("unexpected: %v", err)
	}
}

func TestAuthenticate_BasicIntrospectionAuth(t *testing.T) {
	expected := "Basic " + base64.StdEncoding.EncodeToString([]byte("introspector:s3cret"))
	hydra := newMockHydra(t,
		map[string]introspectionResponse{"t": {Sub: "a"}},
		expected,
		nil,
	)
	defer hydra.Close()

	ext := newExtension(&Config{
		IntrospectionEndpoint: hydra.URL,
		IntrospectionAuth: IntrospectionAuthConfig{
			Type:         authTypeBasic,
			ClientID:     "introspector",
			ClientSecret: "s3cret",
		},
	}, zaptest.NewLogger(t))

	if _, err := ext.Authenticate(context.Background(), map[string][]string{
		"Authorization": {"Bearer t"},
	}); err != nil {
		t.Fatalf("unexpected: %v", err)
	}
}

func TestAuthenticate_HydraDown(t *testing.T) {
	// Use a port we know isn't listening.
	ext := newExtension(&Config{
		IntrospectionEndpoint: "http://127.0.0.1:1/", // port 1 is reserved
	}, zaptest.NewLogger(t))

	_, err := ext.Authenticate(context.Background(), map[string][]string{
		"Authorization": {"Bearer x"},
	})
	if err == nil {
		t.Fatal("expected error when Hydra is unreachable")
	}
}
