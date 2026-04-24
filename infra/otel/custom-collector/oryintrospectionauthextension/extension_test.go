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
		CacheTTL:              durPtr(1 * time.Minute),
		CacheMaxEntries:       intPtr(100),
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
		CacheTTL:              durPtr(1 * time.Minute),
		CacheMaxEntries:       intPtr(100),
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

	// Use a wide sleep/TTL ratio (10× rather than 2.5×) to keep this
	// test stable under CI scheduling jitter — `time.Sleep` guarantees
	// AT LEAST the given duration, and noisy CIs can stretch a 50ms
	// sleep enough to race a 20ms TTL if they're too close together.
	ext := newExtension(&Config{
		IntrospectionEndpoint: hydra.URL,
		CacheTTL:              durPtr(20 * time.Millisecond),
		CacheMaxEntries:       intPtr(100),
	}, zaptest.NewLogger(t))

	_, _ = ext.Authenticate(context.Background(), map[string][]string{
		"Authorization": {"Bearer ttl-token"},
	})
	time.Sleep(200 * time.Millisecond)
	_, _ = ext.Authenticate(context.Background(), map[string][]string{
		"Authorization": {"Bearer ttl-token"},
	})
	if got := atomic.LoadInt32(&calls); got != 2 {
		t.Errorf("expected 2 introspection calls after TTL expiry, got %d", got)
	}
}

// TestAuthenticate_CacheRespectsTokenExp confirms that when a token's
// `exp` claim is sooner than the configured CacheTTL, we honor the
// token's expiry — not the TTL. Without this, a token that Hydra would
// reject on re-check could keep being served from cache.
func TestAuthenticate_CacheRespectsTokenExp(t *testing.T) {
	var calls int32
	// Token expires in 30ms (now + 30ms rounded to whole seconds won't
	// work because Exp is unix seconds). Use a past-boundary trick:
	// set exp = now+1 so the next read is on the verge; sleep 1.1s;
	// the cache must evict on the second read even though CacheTTL is
	// 1 minute.
	tokenExp := time.Now().Add(1 * time.Second).Unix()
	hydra := newMockHydra(t, map[string]introspectionResponse{
		"short-lived": {Sub: "agent-s", Exp: tokenExp},
	}, "", &calls)
	defer hydra.Close()

	ext := newExtension(&Config{
		IntrospectionEndpoint: hydra.URL,
		CacheTTL:              durPtr(1 * time.Minute),
		CacheMaxEntries:       intPtr(100),
	}, zaptest.NewLogger(t))

	_, _ = ext.Authenticate(context.Background(), map[string][]string{
		"Authorization": {"Bearer short-lived"},
	})
	// Past the token's exp but well within CacheTTL.
	time.Sleep(1100 * time.Millisecond)
	_, _ = ext.Authenticate(context.Background(), map[string][]string{
		"Authorization": {"Bearer short-lived"},
	})
	if got := atomic.LoadInt32(&calls); got != 2 {
		t.Errorf("expected 2 introspection calls (cache must honor exp), got %d", got)
	}
}

// TestAuthenticate_CacheDisabled confirms that CacheTTL=0 makes every
// request introspect fresh — no caching at all.
func TestAuthenticate_CacheDisabled(t *testing.T) {
	var calls int32
	hydra := newMockHydra(t, map[string]introspectionResponse{
		"no-cache-token": {Sub: "agent-n"},
	}, "", &calls)
	defer hydra.Close()

	ext := newExtension(&Config{
		IntrospectionEndpoint: hydra.URL,
		CacheTTL:              durPtr(0),
	}, zaptest.NewLogger(t))

	for i := 0; i < 3; i++ {
		_, _ = ext.Authenticate(context.Background(), map[string][]string{
			"Authorization": {"Bearer no-cache-token"},
		})
	}
	if got := atomic.LoadInt32(&calls); got != 3 {
		t.Errorf("expected 3 introspection calls (cache disabled), got %d", got)
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
