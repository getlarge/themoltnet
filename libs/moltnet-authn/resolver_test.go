package moltnetauthn

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type observedEvent struct{ operation, outcome string }
type recordingObserver struct {
	mu        sync.Mutex
	providers []observedEvent
	cache     []observedEvent
	evictions []string
}

func (o *recordingObserver) ProviderRequest(_ context.Context, operation, outcome string, _ time.Duration) {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.providers = append(o.providers, observedEvent{operation, outcome})
}
func (o *recordingObserver) CacheAccess(_ context.Context, kind, result string) {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.cache = append(o.cache, observedEvent{kind, result})
}
func (o *recordingObserver) CacheEviction(_ context.Context, reason string) {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.evictions = append(o.evictions, reason)
}

func newTestResolver(t *testing.T, handler http.Handler, mutate func(*Config)) (*Resolver, *httptest.Server) {
	t.Helper()
	server := httptest.NewServer(handler)
	cfg := Config{ProjectURL: server.URL, APIKey: "provider-secret", CacheTTL: time.Minute, CacheMaxEntries: 10, RequestTimeout: time.Second, HMACKey: []byte("01234567890123456789012345678901")}
	if mutate != nil {
		mutate(&cfg)
	}
	resolver, err := NewResolver(cfg, &recordingObserver{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(server.Close)
	return resolver, server
}

func TestNewResolverResolvesManagedAndSelfHostedURLs(t *testing.T) {
	managed, err := NewResolver(Config{ProjectURL: "https://project.example", APIKey: "pat"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if managed.cfg.HydraAdminURL != "https://project.example" || managed.cfg.TalosAdminURL != managed.cfg.KratosAdminURL {
		t.Fatalf("managed URL fallback not applied: %#v", managed.cfg)
	}
	selfHosted, err := NewResolver(Config{HydraAdminURL: "http://hydra:4445", TalosAdminURL: "http://talos:4422", KratosAdminURL: "http://kratos:4434"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if selfHosted.cfg.APIKey != "" {
		t.Fatal("self-hosted config unexpectedly acquired an API key")
	}
	if _, err := NewResolver(Config{ProjectURL: "https://project.example"}, nil); err == nil {
		t.Fatal("managed config without an API key was accepted")
	}
	if _, err := NewResolver(Config{HydraAdminURL: "http://hydra", TalosAdminURL: "http://talos", KratosAdminURL: "http://kratos", APIKey: "unexpected"}, nil); err == nil {
		t.Fatal("self-hosted config with an API key was accepted")
	}
}

func TestResolveOAuthUsesHookClaimsAndRequiresAgentScope(t *testing.T) {
	var metadataCalls atomic.Int32
	resolver, _ := newTestResolver(t, http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if req.Header.Get("Authorization") != "Bearer provider-secret" {
			t.Error("provider API key missing")
		}
		switch req.URL.Path {
		case "/admin/oauth2/introspect":
			_ = req.ParseForm()
			if req.Form.Get("token") != "oauth-secret" {
				t.Error("credential was not submitted to introspection")
			}
			_ = json.NewEncoder(w).Encode(map[string]interface{}{"active": true, "client_id": "client-1", "scope": "task:read task:execute", "exp": time.Now().Add(time.Hour).Unix(), "ext": map[string]interface{}{"moltnet:identity_id": "identity-1", "moltnet:subject_type": "agent"}})
		case "/admin/clients/client-1":
			metadataCalls.Add(1)
		default:
			http.NotFound(w, req)
		}
	}), nil)
	principal, err := resolver.Resolve(context.Background(), "oauth-secret")
	if err != nil {
		t.Fatal(err)
	}
	if principal.IdentityID != "identity-1" || principal.SubjectType != SubjectAgent || principal.CredentialType != CredentialOAuth {
		t.Fatalf("unexpected principal: %#v", principal)
	}
	if metadataCalls.Load() != 0 {
		t.Fatal("client metadata fallback used despite hook claims")
	}
}

func TestResolveOAuthClientMetadataFallbackAndHumanRejection(t *testing.T) {
	var human atomic.Bool
	resolver, _ := newTestResolver(t, http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		switch req.URL.Path {
		case "/admin/oauth2/introspect":
			_ = json.NewEncoder(w).Encode(map[string]interface{}{"active": true, "client_id": "legacy", "scope": []string{"task:execute"}})
		case "/admin/clients/legacy":
			kind := "moltnet_agent"
			if human.Load() {
				kind = "moltnet_human"
			}
			_ = json.NewEncoder(w).Encode(map[string]interface{}{"metadata": map[string]interface{}{"type": kind, "identity_id": "legacy-identity"}})
		}
	}), func(cfg *Config) { cfg.CacheTTL = time.Nanosecond })
	principal, err := resolver.Resolve(context.Background(), "legacy-token")
	if err != nil || principal.IdentityID != "legacy-identity" {
		t.Fatalf("fallback failed: %#v %v", principal, err)
	}
	time.Sleep(time.Millisecond)
	human.Store(true)
	_, err = resolver.Resolve(context.Background(), "legacy-token")
	var invalid *InvalidError
	if !errors.As(err, &invalid) {
		t.Fatalf("human credential should be invalid, got %v", err)
	}
}

func TestResolveOAuthDoesNotOverrideExplicitHumanClaimsWithClientMetadata(t *testing.T) {
	resolver, _ := newTestResolver(t, http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		switch req.URL.Path {
		case "/admin/oauth2/introspect":
			_ = json.NewEncoder(w).Encode(map[string]interface{}{"active": true, "client_id": "legacy", "scope": "task:execute", "ext": map[string]interface{}{"moltnet:identity_id": "human-identity", "moltnet:subject_type": "human"}})
		case "/admin/clients/legacy":
			_ = json.NewEncoder(w).Encode(map[string]interface{}{"metadata": map[string]interface{}{"type": "moltnet_agent", "identity_id": "agent-identity"}})
		}
	}), nil)
	_, err := resolver.Resolve(context.Background(), "human-token")
	var invalid *InvalidError
	if !errors.As(err, &invalid) {
		t.Fatalf("explicit human claims should be rejected, got %T %v", err, err)
	}
}

func TestResolveRejectsInactiveAndWrongScope(t *testing.T) {
	for _, tc := range []struct {
		name     string
		response map[string]interface{}
	}{
		{"inactive", map[string]interface{}{"active": false}},
		{"expired", map[string]interface{}{"active": true, "client_id": "c", "scope": "task:execute", "exp": time.Now().Add(-time.Minute).Unix(), "ext": map[string]interface{}{"moltnet:identity_id": "i", "moltnet:subject_type": "agent"}}},
		{"scope", map[string]interface{}{"active": true, "client_id": "c", "scope": "task:read", "ext": map[string]interface{}{"moltnet:identity_id": "i", "moltnet:subject_type": "agent"}}},
		{"human", map[string]interface{}{"active": true, "client_id": "c", "scope": "task:execute", "ext": map[string]interface{}{"moltnet:identity_id": "i", "moltnet:subject_type": "human"}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			resolver, _ := newTestResolver(t, http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				if strings.HasPrefix(req.URL.Path, "/admin/clients/") {
					_ = json.NewEncoder(w).Encode(map[string]interface{}{"metadata": map[string]interface{}{"type": "moltnet_human", "identity_id": "i"}})
					return
				}
				_ = json.NewEncoder(w).Encode(tc.response)
			}), nil)
			_, err := resolver.Resolve(context.Background(), "token")
			var invalid *InvalidError
			if !errors.As(err, &invalid) {
				t.Fatalf("expected InvalidError, got %T %v", err, err)
			}
		})
	}
}

func TestResolveTalosChecksStatusVisibilityExpiryKratosAndTeam(t *testing.T) {
	var kratosState atomic.Value
	kratosState.Store("active")
	resolver, _ := newTestResolver(t, http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		switch req.URL.Path {
		case "/v2alpha1/admin/apiKeys:verify":
			if req.Header.Get("Cache-Control") != "no-store" {
				t.Error("Talos cache bypass missing")
			}
			_ = json.NewEncoder(w).Encode(map[string]interface{}{"is_valid": true, "actor_id": "identity-talos", "key_id": "key-1", "status": "KEY_STATUS_ACTIVE", "visibility": "KEY_VISIBILITY_SECRET", "expire_time": time.Now().Add(time.Hour).Format(time.RFC3339), "scopes": []string{"task:execute"}, "metadata": map[string]interface{}{"subject_type": "agent", "team_id": "team-1"}})
		case "/admin/identities/identity-talos":
			_ = json.NewEncoder(w).Encode(map[string]interface{}{"id": "identity-talos", "state": kratosState.Load()})
		default:
			http.NotFound(w, req)
		}
	}), func(cfg *Config) { cfg.CacheTTL = time.Nanosecond })
	principal, err := resolver.Resolve(context.Background(), "ory_ak_secret")
	if err != nil {
		t.Fatal(err)
	}
	if principal.KeyID != "key-1" || principal.TeamID != "team-1" || principal.IdentityID != "identity-talos" {
		t.Fatalf("unexpected Talos principal: %#v", principal)
	}
	time.Sleep(time.Millisecond)
	kratosState.Store("inactive")
	_, err = resolver.Resolve(context.Background(), "ory_ak_secret")
	var invalid *InvalidError
	if !errors.As(err, &invalid) {
		t.Fatalf("inactive Kratos actor should fail: %v", err)
	}
}

func TestResolveTalosRejectsInvalidStatusVisibilityAndExpiry(t *testing.T) {
	now := time.Now()
	for _, tc := range []struct {
		name   string
		mutate func(map[string]interface{})
	}{
		{"inactive status", func(response map[string]interface{}) { response["status"] = "KEY_STATUS_INACTIVE" }},
		{"public visibility", func(response map[string]interface{}) { response["visibility"] = "KEY_VISIBILITY_PUBLIC" }},
		{"expired", func(response map[string]interface{}) {
			response["expire_time"] = now.Add(-time.Second).Format(time.RFC3339)
		}},
		{"invalid team binding", func(response map[string]interface{}) {
			response["metadata"] = map[string]interface{}{"subject_type": "agent", "team_id": 123}
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var kratosCalls atomic.Int32
			resolver, _ := newTestResolver(t, http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				if req.URL.Path == "/admin/identities/identity-talos" {
					kratosCalls.Add(1)
					_ = json.NewEncoder(w).Encode(map[string]interface{}{"id": "identity-talos", "state": "active"})
					return
				}
				response := map[string]interface{}{
					"is_valid": true, "actor_id": "identity-talos", "key_id": "key-1",
					"status": "KEY_STATUS_ACTIVE", "visibility": "KEY_VISIBILITY_SECRET",
					"expire_time": now.Add(time.Hour).Format(time.RFC3339),
					"scopes":      []string{"task:execute"}, "metadata": map[string]interface{}{"subject_type": "agent"},
				}
				tc.mutate(response)
				_ = json.NewEncoder(w).Encode(response)
			}), func(cfg *Config) { cfg.Now = func() time.Time { return now } })

			_, err := resolver.Resolve(context.Background(), "ory_ak_secret")
			var invalid *InvalidError
			if !errors.As(err, &invalid) {
				t.Fatalf("expected InvalidError, got %T %v", err, err)
			}
			if kratosCalls.Load() != 0 {
				t.Fatalf("Kratos called for a rejected key")
			}
		})
	}
}

func TestProviderFailuresAreTypedAndSecretSafe(t *testing.T) {
	for _, status := range []int{http.StatusTooManyRequests, http.StatusServiceUnavailable} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			resolver, _ := newTestResolver(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { http.Error(w, "provider body with secret", status) }), nil)
			credential := "very-secret-credential"
			_, err := resolver.Resolve(context.Background(), credential)
			if status == http.StatusTooManyRequests {
				var typed *RateLimitedError
				if !errors.As(err, &typed) {
					t.Fatalf("expected rate limited error: %v", err)
				}
			} else {
				var typed *UnavailableError
				if !errors.As(err, &typed) {
					t.Fatalf("expected unavailable error: %v", err)
				}
			}
			if strings.Contains(err.Error(), credential) || strings.Contains(err.Error(), "provider body") {
				t.Fatalf("diagnostic leaked secret material: %v", err)
			}
		})
	}
}

func TestProviderTimeoutIsUnavailable(t *testing.T) {
	resolver, _ := newTestResolver(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(25 * time.Millisecond)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"active": true})
	}), func(cfg *Config) { cfg.RequestTimeout = time.Millisecond })
	_, err := resolver.Resolve(context.Background(), "oauth-secret")
	var unavailable *UnavailableError
	if !errors.As(err, &unavailable) {
		t.Fatalf("expected UnavailableError, got %T %v", err, err)
	}
}

func TestPositiveCacheSingleFlightExpiryLRUAndEviction(t *testing.T) {
	var calls atomic.Int32
	now := time.Now()
	resolver, _ := newTestResolver(t, http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		calls.Add(1)
		time.Sleep(10 * time.Millisecond)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"active": true, "client_id": req.FormValue("token"), "scope": "task:execute", "exp": now.Add(time.Hour).Unix(), "ext": map[string]interface{}{"moltnet:identity_id": req.FormValue("token") + "-identity", "moltnet:subject_type": "agent"}})
	}), func(cfg *Config) { cfg.CacheMaxEntries = 2; cfg.Now = func() time.Time { return now } })
	var wg sync.WaitGroup
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := resolver.Resolve(context.Background(), "a"); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if calls.Load() != 1 {
		t.Fatalf("single-flight made %d calls", calls.Load())
	}
	_, _ = resolver.Resolve(context.Background(), "b")
	_, _ = resolver.Resolve(context.Background(), "a")
	_, _ = resolver.Resolve(context.Background(), "c")
	_, _ = resolver.Resolve(context.Background(), "b")
	if calls.Load() != 4 {
		t.Fatalf("LRU eviction contract made %d calls, want 4", calls.Load())
	}
	resolver.EvictOAuthClient("a")
	_, _ = resolver.Resolve(context.Background(), "a")
	if calls.Load() != 5 {
		t.Fatalf("explicit client eviction did not reload, calls=%d", calls.Load())
	}
	now = now.Add(61 * time.Second)
	_, _ = resolver.Resolve(context.Background(), "a")
	if calls.Load() != 6 {
		t.Fatalf("TTL expiry did not reload, calls=%d", calls.Load())
	}
}

func TestPositiveCacheTTLIsCappedByCredentialExpiry(t *testing.T) {
	var calls atomic.Int32
	now := time.Now().Truncate(time.Second)
	expiresAt := now.Add(10 * time.Second)
	resolver, _ := newTestResolver(t, http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if calls.Add(1) > 1 {
			_ = json.NewEncoder(w).Encode(map[string]interface{}{"active": false})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"active": true, "client_id": "client", "scope": "task:execute",
			"exp": expiresAt.Unix(),
			"ext": map[string]interface{}{"moltnet:identity_id": "identity", "moltnet:subject_type": "agent"},
		})
	}), func(cfg *Config) {
		cfg.CacheTTL = time.Minute
		cfg.Now = func() time.Time { return now }
	})
	if _, err := resolver.Resolve(context.Background(), "oauth-secret"); err != nil {
		t.Fatal(err)
	}
	now = now.Add(11 * time.Second)
	if _, err := resolver.Resolve(context.Background(), "oauth-secret"); err == nil {
		t.Fatal("expired credential unexpectedly resolved")
	}
	if calls.Load() != 2 {
		t.Fatalf("credential expiry did not cap cache TTL, calls=%d", calls.Load())
	}
}
