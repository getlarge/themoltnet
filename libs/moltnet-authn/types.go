// Package moltnetauthn resolves MoltNet agent credentials without depending on
// the MoltNet database. It supports Ory Hydra OAuth tokens and Ory Talos API
// keys and deliberately rejects human principals.
package moltnetauthn

import (
	"context"
	"net/http"
	"time"
)

const (
	SubjectAgent           = "agent"
	CredentialOAuth        = "oauth"
	CredentialTalos        = "talos"
	IdentityIDAttribute    = "moltnet.identity_id"
	DefaultRequiredScope   = "task:execute"
	DefaultCacheTTL        = 60 * time.Second
	DefaultCacheMaxEntries = 10_000
	DefaultRequestTimeout  = 5 * time.Second
)

// Principal is the trusted identity resolved from a bearer credential.
type Principal struct {
	SubjectType    string
	IdentityID     string
	ClientID       string
	KeyID          string
	CredentialType string
	Scopes         []string
	TeamID         string
	ExpiresAt      time.Time
}

// Config accepts either an Ory Network project URL plus one API key, or
// individual self-hosted admin URLs without an API key.
type Config struct {
	ProjectURL      string
	APIKey          string
	HydraAdminURL   string
	TalosAdminURL   string
	KratosAdminURL  string
	RequiredScopes  []string
	CacheTTL        time.Duration
	CacheMaxEntries int
	RequestTimeout  time.Duration
	HTTPClient      *http.Client
	HMACKey         []byte
	Now             func() time.Time
}

// Observer receives only bounded, low-cardinality authentication events.
// Implementations must never attach credential or identity values.
type Observer interface {
	ProviderRequest(ctx context.Context, operation, outcome string, latency time.Duration)
	CacheAccess(ctx context.Context, credentialType, result string)
	CacheEviction(ctx context.Context, reason string)
}

type noopObserver struct{}

func (noopObserver) ProviderRequest(context.Context, string, string, time.Duration) {}
func (noopObserver) CacheAccess(context.Context, string, string)                    {}
func (noopObserver) CacheEviction(context.Context, string)                          {}
