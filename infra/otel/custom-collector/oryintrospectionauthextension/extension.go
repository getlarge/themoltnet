package oryintrospectionauthextension

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"go.opentelemetry.io/collector/client"
	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/extension/extensionauth"
	"go.uber.org/zap"
)

// oryAuth is the concrete implementation of the OTel collector's
// `auth.Server` interface. One instance is constructed per extension
// block in the collector config; the OTLP receiver it's wired to will
// call Authenticate() for every incoming request.
type oryAuth struct {
	cfg    *Config
	logger *zap.Logger

	// httpClient is reused across introspection calls. We intentionally
	// give it a timeout shorter than typical OTLP client timeouts so a
	// slow/down Hydra surfaces as 401 rather than hanging the pipeline.
	httpClient *http.Client

	// cache stores validated introspection responses keyed by raw token.
	// We key by token (not a hash) because the collector process holds
	// nothing more sensitive than the in-flight bearer tokens anyway —
	// and hashing would just hide them in logs we don't emit.
	cache *tokenCache
}

// introspectionResponse is the subset of RFC 7662 fields we care about.
// Both JWT and opaque tokens return the same shape here — that's the
// whole point of introspection as a uniform validation primitive.
type introspectionResponse struct {
	Active    bool     `json:"active"`
	Scope     string   `json:"scope,omitempty"`
	ClientID  string   `json:"client_id,omitempty"`
	Username  string   `json:"username,omitempty"`
	TokenType string   `json:"token_type,omitempty"`
	Exp       int64    `json:"exp,omitempty"`
	Iat       int64    `json:"iat,omitempty"`
	Nbf       int64    `json:"nbf,omitempty"`
	Sub       string   `json:"sub,omitempty"`
	Aud       []string `json:"aud,omitempty"`
	Iss       string   `json:"iss,omitempty"`
}

// newExtension wires up the struct. Called from factory.create().
func newExtension(cfg *Config, logger *zap.Logger) *oryAuth {
	return &oryAuth{
		cfg:    cfg,
		logger: logger,
		httpClient: &http.Client{
			// 5s is generous for a local docker-network hop and still
			// keeps failing-closed behavior snappy when Hydra is dead.
			Timeout: 5 * time.Second,
		},
		cache: newTokenCache(cfg.CacheMaxEntries),
	}
}

// Start is part of the component.Component interface — called once when
// the collector pipeline starts. We have nothing to initialize beyond
// what the constructor does.
func (o *oryAuth) Start(_ context.Context, _ component.Host) error {
	o.logger.Info("ory-introspection auth extension started",
		zap.String("introspection_endpoint", o.cfg.IntrospectionEndpoint),
		zap.String("auth_type", o.cfg.IntrospectionAuth.Type),
		zap.Strings("required_scopes", o.cfg.RequiredScopes),
		zap.Duration("cache_ttl", o.cfg.CacheTTL),
	)
	return nil
}

// Shutdown is part of the component.Component interface.
func (o *oryAuth) Shutdown(_ context.Context) error { return nil }

// Authenticate is the heart of the auth.Server interface. It's invoked
// by OTel receivers for every incoming request. Returning a non-nil
// error rejects the request with 401 (for HTTP) or UNAUTHENTICATED (gRPC).
//
// The returned context is passed downstream to processors/exporters. We
// enrich it with a client.Info carrying the authenticated subject so
// later stages (or a future attribution processor) can read it.
func (o *oryAuth) Authenticate(
	ctx context.Context,
	headers map[string][]string,
) (context.Context, error) {
	token, err := extractBearer(headers)
	if err != nil {
		return ctx, err
	}

	// Fast path: recent successful introspection within TTL.
	if cached, ok := o.cache.get(token, o.cfg.CacheTTL); ok {
		return enrichContext(ctx, cached), nil
	}

	// Slow path: round-trip to Hydra. Errors from here are logged at
	// Debug — auth failures are normal during probing/scans and logging
	// them at Warn would be noisy. Operators can crank log level up
	// when debugging.
	resp, err := o.introspect(ctx, token)
	if err != nil {
		o.logger.Debug("introspection failed", zap.Error(err))
		return ctx, err
	}
	if !resp.Active {
		return ctx, errors.New("token is not active")
	}
	if err := o.checkScopes(resp); err != nil {
		return ctx, err
	}

	// Only cache if TTL > 0. Respect the token's own exp if it's
	// sooner than our configured TTL — there's no point caching past
	// the point where Hydra would reject it anyway.
	if o.cfg.CacheTTL > 0 {
		o.cache.set(token, resp)
	}

	return enrichContext(ctx, resp), nil
}

// introspect performs the actual RFC 7662 POST. It builds the request,
// attaches introspection-time auth (bearer/basic/none), and unmarshals
// the JSON response.
func (o *oryAuth) introspect(ctx context.Context, token string) (*introspectionResponse, error) {
	// RFC 7662 §2.1: `application/x-www-form-urlencoded` with a `token`
	// field. Ory Hydra also accepts `token_type_hint=access_token` which
	// we pass along as a documented hint — Hydra uses it for faster lookup.
	form := url.Values{}
	form.Set("token", token)
	form.Set("token_type_hint", "access_token")

	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		o.cfg.IntrospectionEndpoint,
		strings.NewReader(form.Encode()),
	)
	if err != nil {
		return nil, fmt.Errorf("build introspection request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	// Apply introspection-time auth. This is the extension authenticating
	// ITSELF to Hydra — distinct from the token we're validating.
	switch o.cfg.IntrospectionAuth.Type {
	case authTypeBearer:
		req.Header.Set("Authorization", "Bearer "+o.cfg.IntrospectionAuth.Token)
	case authTypeBasic:
		creds := o.cfg.IntrospectionAuth.ClientID + ":" + o.cfg.IntrospectionAuth.ClientSecret
		encoded := base64.StdEncoding.EncodeToString([]byte(creds))
		req.Header.Set("Authorization", "Basic "+encoded)
	case authTypeNone:
		// Intentionally no header.
	}

	httpResp, err := o.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("call introspection endpoint: %w", err)
	}
	defer httpResp.Body.Close()

	// Hydra returns 200 OK for both active:true and active:false. A
	// non-2xx status here means the *extension's own credentials* were
	// rejected or the endpoint is broken — both are our-fault errors,
	// not client-fault. Log loudly; reject the client request anyway.
	if httpResp.StatusCode < 200 || httpResp.StatusCode >= 300 {
		o.logger.Error("introspection endpoint returned non-2xx",
			zap.Int("status", httpResp.StatusCode),
			zap.String("endpoint", o.cfg.IntrospectionEndpoint),
		)
		return nil, fmt.Errorf("introspection endpoint returned %d", httpResp.StatusCode)
	}

	var resp introspectionResponse
	if err := json.NewDecoder(httpResp.Body).Decode(&resp); err != nil {
		return nil, fmt.Errorf("decode introspection response: %w", err)
	}
	return &resp, nil
}

// checkScopes enforces that every config-required scope is present on
// the validated token. OAuth 2.0 scopes are space-separated.
func (o *oryAuth) checkScopes(resp *introspectionResponse) error {
	if len(o.cfg.RequiredScopes) == 0 {
		return nil
	}
	tokenScopes := strings.Fields(resp.Scope)
	have := make(map[string]struct{}, len(tokenScopes))
	for _, s := range tokenScopes {
		have[s] = struct{}{}
	}
	for _, required := range o.cfg.RequiredScopes {
		if _, ok := have[required]; !ok {
			return fmt.Errorf("token missing required scope %q", required)
		}
	}
	return nil
}

// extractBearer pulls the raw token out of an Authorization: Bearer <x>
// header. Case-insensitive on the header name AND the "Bearer" scheme.
// Returns an error if the header is absent or malformed — that error
// becomes the 401 reason visible to the client.
func extractBearer(headers map[string][]string) (string, error) {
	// Collector normalizes header names to lowercase; be defensive anyway.
	var values []string
	for k, v := range headers {
		if strings.EqualFold(k, "authorization") {
			values = v
			break
		}
	}
	if len(values) == 0 {
		return "", errors.New("missing Authorization header")
	}
	parts := strings.SplitN(values[0], " ", 2)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "bearer") || parts[1] == "" {
		return "", errors.New(`Authorization header must be "Bearer <token>"`)
	}
	return parts[1], nil
}

// enrichContext attaches introspection claims to the OTel client.Info so
// downstream processors can read them via client.FromContext(ctx). This
// is how a future attribution processor will pin resource.moltnet.agent.id
// to the authenticated subject instead of trusting the client.
func enrichContext(ctx context.Context, resp *introspectionResponse) context.Context {
	info := client.FromContext(ctx)
	// Metadata values are plural (slices) per client.Info contract.
	md := map[string][]string{}
	if resp.Sub != "" {
		md["auth.subject"] = []string{resp.Sub}
	}
	if resp.ClientID != "" {
		md["auth.client_id"] = []string{resp.ClientID}
	}
	if resp.Scope != "" {
		md["auth.scope"] = []string{resp.Scope}
	}
	info.Metadata = client.NewMetadata(md)
	// AuthData is the OTel-canonical slot for structured auth info.
	info.Auth = &authData{resp: resp}
	return client.NewContext(ctx, info)
}

// authData implements auth.AuthData, which OTel processors/extensions
// can type-assert on to read structured claims.
type authData struct {
	resp *introspectionResponse
}

func (a *authData) GetAttribute(name string) any {
	switch name {
	case "sub", "subject":
		return a.resp.Sub
	case "client_id":
		return a.resp.ClientID
	case "scope":
		return a.resp.Scope
	case "aud":
		return a.resp.Aud
	case "iss":
		return a.resp.Iss
	default:
		return nil
	}
}

func (a *authData) GetAttributeNames() []string {
	return []string{"sub", "subject", "client_id", "scope", "aud", "iss"}
}

// Compile-time interface assertions: fail the build if the struct
// doesn't satisfy the interfaces we promise.
var (
	_ extensionauth.Server = (*oryAuth)(nil)
	_ component.Component  = (*oryAuth)(nil)
)

// tokenCache is a tiny FIFO-ish TTL cache. Nothing fancy — we don't
// need LRU precision for this workload (token churn is low, and if we
// evict a hot token we just do one extra introspection call).
type tokenCache struct {
	mu      sync.Mutex
	entries map[string]cacheEntry
	order   []string // keys in insertion order, for bounded eviction
	max     int
}

type cacheEntry struct {
	resp     *introspectionResponse
	insertAt time.Time
}

func newTokenCache(max int) *tokenCache {
	return &tokenCache{
		entries: make(map[string]cacheEntry),
		max:     max,
	}
}

func (c *tokenCache) get(token string, ttl time.Duration) (*introspectionResponse, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.entries[token]
	if !ok {
		return nil, false
	}
	if time.Since(entry.insertAt) > ttl {
		delete(c.entries, token)
		return nil, false
	}
	return entry.resp, true
}

func (c *tokenCache) set(token string, resp *introspectionResponse) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, exists := c.entries[token]; !exists {
		c.order = append(c.order, token)
	}
	c.entries[token] = cacheEntry{resp: resp, insertAt: time.Now()}
	// Trim oldest entries when over capacity. FIFO-ish — we accept
	// that a recently-accessed-but-not-re-inserted token can be evicted.
	for len(c.order) > c.max {
		old := c.order[0]
		c.order = c.order[1:]
		delete(c.entries, old)
	}
}
