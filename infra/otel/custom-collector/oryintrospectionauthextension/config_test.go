package oryintrospectionauthextension

import (
	"testing"
	"time"
)

// TestConfig_Validate exercises each branch of Config.Validate(). We do
// this exhaustively because misconfiguration in production means the
// collector fails to start — much better to surface mistakes at config
// load than at runtime.
func TestConfig_Validate(t *testing.T) {
	tests := []struct {
		name    string
		cfg     Config
		wantErr string // substring match; empty = expect success
	}{
		{
			name:    "missing endpoint",
			cfg:     Config{},
			wantErr: "introspection_endpoint is required",
		},
		{
			name: "endpoint with non-http scheme",
			cfg: Config{
				IntrospectionEndpoint: "file:///etc/passwd",
			},
			wantErr: "must use http or https",
		},
		{
			name: "bearer auth without token",
			cfg: Config{
				IntrospectionEndpoint: "https://hydra/introspect",
				IntrospectionAuth:     IntrospectionAuthConfig{Type: authTypeBearer},
			},
			wantErr: `"bearer" requires a non-empty token`,
		},
		{
			name: "basic auth missing client_secret",
			cfg: Config{
				IntrospectionEndpoint: "https://hydra/introspect",
				IntrospectionAuth: IntrospectionAuthConfig{
					Type:     authTypeBasic,
					ClientID: "id-only",
				},
			},
			wantErr: `"basic" requires both client_id and client_secret`,
		},
		{
			name: "unknown auth type",
			cfg: Config{
				IntrospectionEndpoint: "https://hydra/introspect",
				IntrospectionAuth:     IntrospectionAuthConfig{Type: "mutual-tls"},
			},
			wantErr: `must be "bearer", "basic", or "none"`,
		},
		{
			name: "negative cache TTL",
			cfg: Config{
				IntrospectionEndpoint: "https://hydra/introspect",
				CacheTTL:              durPtr(-1 * time.Second),
			},
			wantErr: "cache_ttl must be non-negative",
		},
		{
			name: "happy path — none",
			cfg: Config{
				IntrospectionEndpoint: "http://hydra-admin:4445/admin/oauth2/introspect",
			},
		},
		{
			name: "happy path — bearer",
			cfg: Config{
				IntrospectionEndpoint: "https://hydra/introspect",
				IntrospectionAuth: IntrospectionAuthConfig{
					Type:  authTypeBearer,
					Token: "ory_pat_xxx",
				},
				RequiredScopes: []string{"telemetry:write"},
				CacheTTL:       durPtr(30 * time.Second),
			},
		},
		{
			name: "explicit cache_ttl=0 (caching disabled) is accepted",
			cfg: Config{
				IntrospectionEndpoint: "https://hydra/introspect",
				CacheTTL:              durPtr(0),
			},
		},
		{
			name: "explicit cache_max_entries=0 (unbounded) is accepted",
			cfg: Config{
				IntrospectionEndpoint: "https://hydra/introspect",
				CacheMaxEntries:       intPtr(0),
			},
		},
		{
			name: "happy path — basic",
			cfg: Config{
				IntrospectionEndpoint: "https://hydra/introspect",
				IntrospectionAuth: IntrospectionAuthConfig{
					Type:         authTypeBasic,
					ClientID:     "introspector",
					ClientSecret: "s3cret",
				},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.cfg.Validate()
			if tt.wantErr == "" {
				if err != nil {
					t.Fatalf("expected no error, got %v", err)
				}
				return
			}
			if err == nil {
				t.Fatalf("expected error containing %q, got nil", tt.wantErr)
			}
			if !containsString(err.Error(), tt.wantErr) {
				t.Fatalf("expected error to contain %q, got %q", tt.wantErr, err.Error())
			}
		})
	}
}

func TestConfig_WithDefaults_AppliesWhenUnset(t *testing.T) {
	c := Config{IntrospectionEndpoint: "https://h/i"}
	c.withDefaults()
	if got := c.effectiveCacheTTL(); got != 30*time.Second {
		t.Errorf("expected default CacheTTL 30s, got %v", got)
	}
	if got := c.effectiveCacheMaxEntries(); got != 10000 {
		t.Errorf("expected default CacheMaxEntries 10000, got %d", got)
	}
}

func TestConfig_WithDefaults_PreservesExplicitZero(t *testing.T) {
	// Regression: previously `withDefaults` rewrote 0 → 30s, making it
	// impossible to disable caching via `cache_ttl: 0` in YAML.
	c := Config{
		IntrospectionEndpoint: "https://h/i",
		CacheTTL:              durPtr(0),
		CacheMaxEntries:       intPtr(0),
	}
	c.withDefaults()
	if got := c.effectiveCacheTTL(); got != 0 {
		t.Errorf("expected explicit CacheTTL=0 preserved, got %v", got)
	}
	if got := c.effectiveCacheMaxEntries(); got != 0 {
		t.Errorf("expected explicit CacheMaxEntries=0 preserved, got %d", got)
	}
}

func durPtr(d time.Duration) *time.Duration { return &d }
func intPtr(i int) *int                     { return &i }

func containsString(s, sub string) bool {
	// tiny helper to avoid pulling strings.Contains import noise in a
	// table-driven test.
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
