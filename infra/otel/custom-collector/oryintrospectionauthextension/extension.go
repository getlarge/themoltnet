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

type oryAuth struct {
	cfg        *Config
	logger     *zap.Logger
	httpClient *http.Client
	cache      *tokenCache
}

// Subset of RFC 7662 fields we use.
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

func newExtension(cfg *Config, logger *zap.Logger) *oryAuth {
	return &oryAuth{
		cfg:    cfg,
		logger: logger,
		// Short timeout so a hung Hydra fails closed quickly instead of
		// stalling the OTLP pipeline.
		httpClient: &http.Client{Timeout: 5 * time.Second},
		cache:      newTokenCache(cfg.effectiveCacheMaxEntries()),
	}
}

func (o *oryAuth) Start(_ context.Context, _ component.Host) error {
	o.logger.Info("ory-introspection auth extension started",
		zap.String("introspection_endpoint", o.cfg.IntrospectionEndpoint),
		zap.String("auth_type", o.cfg.IntrospectionAuth.Type),
		zap.Strings("required_scopes", o.cfg.RequiredScopes),
		zap.Duration("cache_ttl", o.cfg.effectiveCacheTTL()),
	)
	return nil
}

func (o *oryAuth) Shutdown(_ context.Context) error { return nil }

func (o *oryAuth) Authenticate(
	ctx context.Context,
	headers map[string][]string,
) (context.Context, error) {
	token, err := extractBearer(headers)
	if err != nil {
		return ctx, err
	}

	if cached, ok := o.cache.get(token); ok {
		return enrichContext(ctx, cached), nil
	}

	resp, err := o.introspect(ctx, token)
	if err != nil {
		// Auth failures are normal during probing — keep at Debug.
		o.logger.Debug("introspection failed", zap.Error(err))
		return ctx, err
	}
	if !resp.Active {
		return ctx, errors.New("token is not active")
	}
	if err := o.checkScopes(resp); err != nil {
		return ctx, err
	}

	if ttl := o.cfg.effectiveCacheTTL(); ttl > 0 {
		o.cache.set(token, resp, ttl)
	}

	return enrichContext(ctx, resp), nil
}

func (o *oryAuth) introspect(ctx context.Context, token string) (*introspectionResponse, error) {
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

	// Extension authenticating ITSELF to Hydra (not the token being validated).
	switch o.cfg.IntrospectionAuth.Type {
	case authTypeBearer:
		req.Header.Set("Authorization", "Bearer "+o.cfg.IntrospectionAuth.Token)
	case authTypeBasic:
		creds := o.cfg.IntrospectionAuth.ClientID + ":" + o.cfg.IntrospectionAuth.ClientSecret
		encoded := base64.StdEncoding.EncodeToString([]byte(creds))
		req.Header.Set("Authorization", "Basic "+encoded)
	case authTypeNone:
	}

	httpResp, err := o.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("call introspection endpoint: %w", err)
	}
	defer httpResp.Body.Close()

	// Hydra returns 200 for both active:true and active:false. Non-2xx
	// means OUR credentials were rejected or the endpoint is broken —
	// log loudly, still reject the client request.
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

func extractBearer(headers map[string][]string) (string, error) {
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

// enrichContext makes claims readable downstream via client.FromContext —
// for a future attribution processor that pins resource.moltnet.agent.id
// to the authenticated subject instead of trusting the client.
func enrichContext(ctx context.Context, resp *introspectionResponse) context.Context {
	info := client.FromContext(ctx)
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
	info.Auth = &authData{resp: resp}
	return client.NewContext(ctx, info)
}

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

var (
	_ extensionauth.Server = (*oryAuth)(nil)
	_ component.Component  = (*oryAuth)(nil)
)

// tokenCache: bounded FIFO TTL cache. Entries store absolute expiresAt =
// min(now + TTL, token.exp), so we never serve a token from cache past
// the point Hydra would reject it. max == 0 means unbounded.
type tokenCache struct {
	mu      sync.Mutex
	entries map[string]cacheEntry
	order   []string
	max     int
}

type cacheEntry struct {
	resp      *introspectionResponse
	expiresAt time.Time
}

func newTokenCache(max int) *tokenCache {
	return &tokenCache{
		entries: make(map[string]cacheEntry),
		max:     max,
	}
}

// get evicts expired entries from the map only; the order slice is
// compacted lazily during the next set().
func (c *tokenCache) get(token string) (*introspectionResponse, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.entries[token]
	if !ok {
		return nil, false
	}
	if time.Now().After(entry.expiresAt) {
		delete(c.entries, token)
		return nil, false
	}
	return entry.resp, true
}

func (c *tokenCache) set(token string, resp *introspectionResponse, ttl time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()

	expiresAt := time.Now().Add(ttl)
	if resp.Exp > 0 {
		if tokenExp := time.Unix(resp.Exp, 0); tokenExp.Before(expiresAt) {
			expiresAt = tokenExp
		}
	}

	if _, exists := c.entries[token]; !exists {
		c.order = append(c.order, token)
	}
	c.entries[token] = cacheEntry{resp: resp, expiresAt: expiresAt}

	if c.max > 0 {
		// Drop stale order references left by lazy get()-time eviction,
		// then trim FIFO to bound. Compacting here amortizes the cost.
		compacted := c.order[:0]
		for _, key := range c.order {
			if _, present := c.entries[key]; present {
				compacted = append(compacted, key)
			}
		}
		c.order = compacted

		for len(c.order) > c.max {
			old := c.order[0]
			c.order = c.order[1:]
			delete(c.entries, old)
		}
	}
}
