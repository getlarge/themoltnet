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
	// keyed by token value. Pointer so we can distinguish "unset"
	// (apply the 30s default) from "explicitly 0" (disable caching —
	// every OTLP request triggers a fresh introspection).
	CacheTTL *time.Duration `mapstructure:"cache_ttl"`

	// CacheMaxEntries caps the in-memory cache size to prevent unbounded
	// growth under token churn. Pointer so we can distinguish "unset"
	// (apply the 10000 default) from "explicitly 0" (unbounded cache —
	// use with care).
	CacheMaxEntries *int `mapstructure:"cache_max_entries"`
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

	if c.CacheTTL != nil && *c.CacheTTL < 0 {
		return errors.New("cache_ttl must be non-negative")
	}
	if c.CacheMaxEntries != nil && *c.CacheMaxEntries < 0 {
		return errors.New("cache_max_entries must be non-negative")
	}

	return nil
}

// withDefaults applies default values for optional fields. Called from
// the factory after Validate() so defaults don't mask validation errors.
// Only fills in defaults for fields left UNSET (nil) — an explicit zero
// is a valid operator choice and must be preserved.
func (c *Config) withDefaults() {
	if c.CacheTTL == nil {
		d := 30 * time.Second
		c.CacheTTL = &d
	}
	if c.CacheMaxEntries == nil {
		d := 10000
		c.CacheMaxEntries = &d
	}
}

// effectiveCacheTTL returns the resolved TTL (never nil after withDefaults).
func (c *Config) effectiveCacheTTL() time.Duration {
	if c.CacheTTL == nil {
		return 30 * time.Second
	}
	return *c.CacheTTL
}

// effectiveCacheMaxEntries returns the resolved max entries.
func (c *Config) effectiveCacheMaxEntries() int {
	if c.CacheMaxEntries == nil {
		return 10000
	}
	return *c.CacheMaxEntries
}
