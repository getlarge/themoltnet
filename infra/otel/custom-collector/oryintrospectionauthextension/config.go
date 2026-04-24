// Package oryintrospectionauthextension implements an OTel collector
// server-side auth extension that validates incoming bearer tokens via
// OAuth 2.0 Token Introspection (RFC 7662).
//
// The extension is designed to accept Ory access tokens — both JWT and
// opaque — by always round-tripping them through the introspection
// endpoint. Local JWT validation is intentionally not supported: the
// collector is reachable from untrusted worker processes, and we want a
// single, authoritative answer from Hydra ("is this token still active?")
// regardless of token format.
//
// Config shape mirrors the Node-side @getlarge/fastify-mcp plugin used
// throughout the rest of the codebase, so operators see a familiar
// IntrospectionAuthConfig union:
//
//	extensions:
//	  oryintrospectionauth:
//	    introspection_endpoint: "http://hydra-admin:4445/admin/oauth2/introspect"
//	    introspection_auth:
//	      type: "bearer"          # "bearer" | "basic" | "none"
//	      token: "${env:ORY_PROJECT_API_KEY}"
//	    required_scopes: ["telemetry:write"]
//	    cache_ttl: 30s
package oryintrospectionauthextension

import (
	"errors"
	"fmt"
	"net/url"
	"time"
)

// Config is the YAML-bindable configuration for the extension.
//
// Every field is a struct tag key (`mapstructure`) — that's how the OTel
// collector's config unmarshaller populates the struct from YAML.
// `omitempty` equivalent is handled by zero-value checks in Validate().
type Config struct {
	// IntrospectionEndpoint is the full URL to the OAuth 2.0 token
	// introspection endpoint. For Ory Hydra self-hosted this is
	// `http://<host>:4445/admin/oauth2/introspect` (admin API, port 4445).
	// For Ory Network it's `https://<project>.projects.oryapis.com/admin/oauth2/introspect`.
	IntrospectionEndpoint string `mapstructure:"introspection_endpoint"`

	// IntrospectionAuth configures how the extension authenticates ITSELF
	// when calling the introspection endpoint. Distinct from the tokens
	// being validated (those come from incoming OTLP requests).
	IntrospectionAuth IntrospectionAuthConfig `mapstructure:"introspection_auth"`

	// RequiredScopes is a list of scopes that MUST be present (as a
	// subset) on the validated token. Empty list = any active token OK.
	// Recommended: ["telemetry:write"] for this extension's use case.
	RequiredScopes []string `mapstructure:"required_scopes"`

	// CacheTTL is how long a successful introspection result is cached
	// keyed by token value. Set to 0 to disable caching (not recommended
	// — each OTLP request would trigger an introspection round-trip).
	// Default: 30s.
	CacheTTL time.Duration `mapstructure:"cache_ttl"`

	// CacheMaxEntries caps the in-memory cache size to prevent unbounded
	// growth under token churn. Older entries are evicted when full.
	// Default: 10000.
	CacheMaxEntries int `mapstructure:"cache_max_entries"`
}

// IntrospectionAuthConfig is a tagged union describing how the extension
// authenticates when calling the introspection endpoint. Mirrors the
// Node-side @getlarge/fastify-mcp IntrospectionAuthConfig for consistency.
//
// YAML shape:
//
//	# Ory Network (Project API Key) or Ory Hydra with a bearer admin token:
//	type: "bearer"
//	token: "ory_pat_xxx"
//
//	# Self-hosted Hydra with admin client credentials (RFC 7662 standard):
//	type: "basic"
//	client_id: "introspector"
//	client_secret: "s3cret"
//
//	# No auth header — token sent in POST body only (rare):
//	type: "none"
type IntrospectionAuthConfig struct {
	// Type is the discriminator: "bearer" | "basic" | "none".
	// Defaults to "none" if the block is omitted entirely.
	Type string `mapstructure:"type"`

	// Token is used when Type == "bearer". Sent as `Authorization: Bearer <token>`.
	Token string `mapstructure:"token"`

	// ClientID is used when Type == "basic".
	ClientID string `mapstructure:"client_id"`

	// ClientSecret is used when Type == "basic". Encoded alongside ClientID
	// as standard HTTP Basic auth per RFC 7662.
	ClientSecret string `mapstructure:"client_secret"`
}

const (
	authTypeBearer = "bearer"
	authTypeBasic  = "basic"
	authTypeNone   = "none"
)

// Validate is called by the collector during config load. Returning a
// non-nil error aborts startup. This is the right place to catch
// obvious misconfigurations before the extension starts accepting traffic.
func (c *Config) Validate() error {
	if c.IntrospectionEndpoint == "" {
		return errors.New("introspection_endpoint is required")
	}

	parsed, err := url.Parse(c.IntrospectionEndpoint)
	if err != nil {
		return fmt.Errorf("introspection_endpoint is not a valid URL: %w", err)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return fmt.Errorf("introspection_endpoint must use http or https, got %q", parsed.Scheme)
	}

	// Default to "none" if the block is completely absent. Otherwise the
	// explicit type must match a known variant.
	if c.IntrospectionAuth.Type == "" {
		c.IntrospectionAuth.Type = authTypeNone
	}
	switch c.IntrospectionAuth.Type {
	case authTypeBearer:
		if c.IntrospectionAuth.Token == "" {
			return errors.New(`introspection_auth.type="bearer" requires a non-empty token`)
		}
	case authTypeBasic:
		if c.IntrospectionAuth.ClientID == "" || c.IntrospectionAuth.ClientSecret == "" {
			return errors.New(`introspection_auth.type="basic" requires both client_id and client_secret`)
		}
	case authTypeNone:
		// no-op
	default:
		return fmt.Errorf(`introspection_auth.type must be "bearer", "basic", or "none"; got %q`, c.IntrospectionAuth.Type)
	}

	if c.CacheTTL < 0 {
		return errors.New("cache_ttl must be non-negative")
	}
	if c.CacheMaxEntries < 0 {
		return errors.New("cache_max_entries must be non-negative")
	}

	return nil
}

// withDefaults applies default values for optional fields. Called from
// the factory after Validate() so defaults don't mask validation errors.
func (c *Config) withDefaults() {
	if c.CacheTTL == 0 {
		c.CacheTTL = 30 * time.Second
	}
	if c.CacheMaxEntries == 0 {
		c.CacheMaxEntries = 10000
	}
}
