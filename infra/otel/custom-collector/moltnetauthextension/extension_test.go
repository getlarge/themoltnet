package moltnetauthextension

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	authn "github.com/getlarge/themoltnet/libs/moltnet-authn"
	"go.opentelemetry.io/collector/client"
	"go.opentelemetry.io/otel/metric/noop"
)

func TestExtractBearer(t *testing.T) {
	credential, err := extractBearer(map[string][]string{"authorization": {"Bearer secret"}})
	if err != nil || credential != "secret" {
		t.Fatalf("unexpected parse: %q %v", credential, err)
	}
	for _, headers := range []map[string][]string{{}, {"Authorization": {"Basic abc"}}, {"Authorization": {"Bearer"}}, {"Authorization": {"Bearer a", "Bearer b"}}} {
		if _, err := extractBearer(headers); err == nil {
			t.Fatalf("expected malformed header rejection: %#v", headers)
		}
	}
}

func TestBoundedLimiterIsolatesAgentsAndBoundsState(t *testing.T) {
	cfg := &Config{GlobalRate: 100, GlobalBurst: 200, AgentRate: 2, AgentBurst: 2, LimiterMaxEntries: 3, LimiterIdleTTL: time.Minute}
	limiter := newBoundedLimiter(cfg)
	now := time.Now()
	limiter.now = func() time.Time { return now }
	limiter.global = newTokenBucket(cfg.GlobalRate, cfg.GlobalBurst, now)
	if !limiter.allowAgent("a") || !limiter.allowAgent("a") || limiter.allowAgent("a") {
		t.Fatal("agent bucket did not enforce its burst")
	}
	if !limiter.allowAgent("b") {
		t.Fatal("agent b was throttled by agent a")
	}
	for _, identity := range []string{"c", "d", "e"} {
		limiter.allowAgent(identity)
	}
	if limiter.size() != 3 {
		t.Fatalf("limiter state grew to %d", limiter.size())
	}
	now = now.Add(2 * time.Minute)
	limiter.allowAgent("fresh")
	if limiter.size() != 1 {
		t.Fatalf("idle limiter state was not evicted: %d", limiter.size())
	}
}

func TestAuthenticatePropagatesTrustedPrincipal(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if req.URL.Path != "/admin/oauth2/introspect" {
			http.NotFound(w, req)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"active": true, "client_id": "agent-client", "scope": "task:execute",
			"ext": map[string]interface{}{"moltnet:identity_id": "agent-identity", "moltnet:subject_type": "agent"},
		})
	}))
	defer server.Close()
	resolver, err := authn.NewResolver(authn.Config{ProjectURL: server.URL, APIKey: "provider-secret"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	cfg := &Config{GlobalRate: 100, GlobalBurst: 200, AgentRate: 2, AgentBurst: 20, LimiterMaxEntries: 100, LimiterIdleTTL: time.Minute}
	meter := noop.NewMeterProvider().Meter("test")
	throttled, _ := meter.Int64Counter("throttled")
	extension := &authExtension{cfg: cfg, resolver: resolver, limiter: newBoundedLimiter(cfg), throttled: throttled}

	ctx, err := extension.Authenticate(context.Background(), map[string][]string{"Authorization": {"Bearer oauth-secret"}})
	if err != nil {
		t.Fatal(err)
	}
	info := client.FromContext(ctx)
	if info.Auth == nil || info.Auth.GetAttribute("moltnet.identity_id") != "agent-identity" || info.Auth.GetAttribute("subject_type") != "agent" {
		t.Fatalf("trusted principal was not propagated: %#v", info.Auth)
	}
}

func TestConfigDefaultsAndValidation(t *testing.T) {
	cfg := &Config{ProjectURL: "https://project.example", APIKey: "provider-secret"}
	if err := cfg.Validate(); err != nil {
		t.Fatal(err)
	}
	if cfg.RequiredScopes[0] != "task:execute" || *cfg.CacheTTL != time.Minute || cfg.GlobalRate != 100 || cfg.AgentBurst != 20 {
		t.Fatalf("unexpected defaults: %#v", cfg)
	}
	if err := (&Config{ProjectURL: "https://project.example"}).Validate(); err == nil {
		t.Fatal("managed config without api_key was accepted")
	}
	if err := (&Config{HydraAdminURL: "http://hydra", TalosAdminURL: "http://talos", KratosAdminURL: "http://kratos", APIKey: "unexpected"}).Validate(); err == nil {
		t.Fatal("self-hosted config with api_key was accepted")
	}
}
