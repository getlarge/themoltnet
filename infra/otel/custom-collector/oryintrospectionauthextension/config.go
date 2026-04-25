// Package oryintrospectionauthextension implements an OTel collector
// server-side auth extension that validates incoming bearer tokens via
// OAuth 2.0 Token Introspection (RFC 7662). Always introspects, so it
// works for both JWT and opaque Ory tokens.
package oryintrospectionauthextension

import (
	"errors"
	"fmt"
	"net/url"
	"time"
)

type Config struct {
	IntrospectionEndpoint string                  `mapstructure:"introspection_endpoint"`
	IntrospectionAuth     IntrospectionAuthConfig `mapstructure:"introspection_auth"`
	RequiredScopes        []string                `mapstructure:"required_scopes"`

	// Pointer types so we can distinguish "unset" (apply default) from
	// "explicitly 0" (disable caching / unbounded cache).
	CacheTTL        *time.Duration `mapstructure:"cache_ttl"`
	CacheMaxEntries *int           `mapstructure:"cache_max_entries"`
}

// IntrospectionAuthConfig mirrors @getlarge/fastify-mcp's
// IntrospectionAuthConfig union: bearer (Ory Network PAT or Hydra admin
// bearer) | basic (RFC 7662 client_credentials) | none.
type IntrospectionAuthConfig struct {
	Type         string `mapstructure:"type"`
	Token        string `mapstructure:"token"`
	ClientID     string `mapstructure:"client_id"`
	ClientSecret string `mapstructure:"client_secret"`
}

const (
	authTypeBearer = "bearer"
	authTypeBasic  = "basic"
	authTypeNone   = "none"
)

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

// withDefaults only fills nil fields — explicit zero is preserved.
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

func (c *Config) effectiveCacheTTL() time.Duration {
	if c.CacheTTL == nil {
		return 30 * time.Second
	}
	return *c.CacheTTL
}

func (c *Config) effectiveCacheMaxEntries() int {
	if c.CacheMaxEntries == nil {
		return 10000
	}
	return *c.CacheMaxEntries
}
