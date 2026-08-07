package moltnetauthn

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type Resolver struct {
	cfg      Config
	observer Observer
	cache    *authCache
}

// NewResolver creates an independent Ory-backed credential resolver. Positive
// results are cached in-process; credentials and identity values are never
// passed to Observer implementations.
func NewResolver(cfg Config, observer Observer) (*Resolver, error) {
	if cfg.ProjectURL != "" && cfg.APIKey == "" {
		return nil, errors.New("Ory Network project URL requires an API key")
	}
	if cfg.ProjectURL == "" && cfg.APIKey != "" {
		return nil, errors.New("self-hosted Ory configuration must not include an API key")
	}
	if cfg.ProjectURL != "" {
		if cfg.HydraAdminURL == "" {
			cfg.HydraAdminURL = cfg.ProjectURL
		}
		if cfg.TalosAdminURL == "" {
			cfg.TalosAdminURL = cfg.ProjectURL
		}
		if cfg.KratosAdminURL == "" {
			cfg.KratosAdminURL = cfg.ProjectURL
		}
	}
	cfg.ProjectURL = strings.TrimRight(cfg.ProjectURL, "/")
	cfg.HydraAdminURL = strings.TrimRight(cfg.HydraAdminURL, "/")
	cfg.TalosAdminURL = strings.TrimRight(cfg.TalosAdminURL, "/")
	cfg.KratosAdminURL = strings.TrimRight(cfg.KratosAdminURL, "/")
	for name, raw := range map[string]string{"hydra": cfg.HydraAdminURL, "talos": cfg.TalosAdminURL, "kratos": cfg.KratosAdminURL} {
		if raw == "" {
			return nil, fmt.Errorf("%s admin URL is required", name)
		}
		parsed, err := url.Parse(raw)
		if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
			return nil, fmt.Errorf("%s admin URL must be an absolute HTTP URL", name)
		}
	}
	if len(cfg.RequiredScopes) == 0 {
		cfg.RequiredScopes = []string{DefaultRequiredScope}
	}
	if cfg.CacheTTL == 0 {
		cfg.CacheTTL = DefaultCacheTTL
	}
	if cfg.CacheTTL < 0 {
		return nil, errors.New("cache TTL must not be negative")
	}
	if cfg.CacheMaxEntries == 0 {
		cfg.CacheMaxEntries = DefaultCacheMaxEntries
	}
	if cfg.CacheMaxEntries < 0 {
		return nil, errors.New("cache max entries must not be negative")
	}
	if cfg.RequestTimeout == 0 {
		cfg.RequestTimeout = DefaultRequestTimeout
	}
	if cfg.RequestTimeout < 0 {
		return nil, errors.New("request timeout must not be negative")
	}
	if cfg.HTTPClient == nil {
		cfg.HTTPClient = http.DefaultClient
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	if len(cfg.HMACKey) == 0 {
		cfg.HMACKey = make([]byte, 32)
		if _, err := rand.Read(cfg.HMACKey); err != nil {
			return nil, fmt.Errorf("generate cache key: %w", err)
		}
	}
	if observer == nil {
		observer = noopObserver{}
	}
	r := &Resolver{cfg: cfg, observer: observer}
	r.cache = newAuthCache(cfg, observer)
	return r, nil
}

// Resolve authenticates an OAuth access token or Talos API key and returns an
// authorized agent principal. Human, inactive, and insufficiently scoped
// credentials return InvalidError.
func (r *Resolver) Resolve(ctx context.Context, credential string) (Principal, error) {
	credential = strings.TrimSpace(credential)
	if credential == "" {
		return Principal{}, &InvalidError{Reason: "missing credential"}
	}
	if strings.HasPrefix(credential, "ory_ak_") {
		return r.cache.resolve(ctx, CredentialTalos, r.cfg.TalosAdminURL, credential, func(loadCtx context.Context) (Principal, string, error) {
			return r.resolveTalos(loadCtx, credential)
		})
	}
	return r.cache.resolve(ctx, CredentialOAuth, r.cfg.HydraAdminURL, credential, func(loadCtx context.Context) (Principal, string, error) {
		return r.resolveOAuth(loadCtx, credential)
	})
}

// EvictOAuthClient removes all positive cache entries for an OAuth client.
func (r *Resolver) EvictOAuthClient(clientID string) {
	r.cache.evictTag(cacheTag("oauth-client", clientID))
}

// EvictTalosKey removes all positive cache entries for a Talos key.
func (r *Resolver) EvictTalosKey(keyID string) { r.cache.evictTag(cacheTag("talos-key", keyID)) }

type introspectionResponse struct {
	Active   bool                   `json:"active"`
	ClientID string                 `json:"client_id"`
	Scope    json.RawMessage        `json:"scope"`
	Exp      int64                  `json:"exp"`
	Ext      map[string]interface{} `json:"ext"`
}

func (r *Resolver) resolveOAuth(ctx context.Context, credential string) (Principal, string, error) {
	form := url.Values{"token": {credential}, "token_type_hint": {"access_token"}}
	var response introspectionResponse
	if err := r.request(ctx, "oauth2.introspect", http.MethodPost, r.cfg.HydraAdminURL+"/admin/oauth2/introspect", strings.NewReader(form.Encode()), "application/x-www-form-urlencoded", &response); err != nil {
		return Principal{}, "", err
	}
	if !response.Active || response.ClientID == "" {
		return Principal{}, "", &InvalidError{Reason: "inactive OAuth token"}
	}
	if response.Exp > 0 && !time.Unix(response.Exp, 0).After(r.cfg.Now()) {
		return Principal{}, "", &InvalidError{Reason: "expired OAuth token"}
	}
	scopes := normalizeScopes(response.Scope)
	claims := flattenClaims(response.Ext)
	principal, ok := principalFromClaims(claims, response.ClientID, scopes)
	claimsPresent := stringValue(claims["moltnet:identity_id"]) != "" || stringValue(claims["moltnet:subject_type"]) != ""
	if claimsPresent && !ok {
		return Principal{}, "", &InvalidError{Reason: "OAuth claims do not identify a canonical agent"}
	}
	if !claimsPresent {
		var client struct {
			Metadata map[string]interface{} `json:"metadata"`
		}
		endpoint := r.cfg.HydraAdminURL + "/admin/clients/" + url.PathEscape(response.ClientID)
		if err := r.request(ctx, "oauth2.client_metadata", http.MethodGet, endpoint, nil, "", &client); err != nil {
			var invalid *InvalidError
			if errors.As(err, &invalid) {
				return Principal{}, "", invalid
			}
			return Principal{}, "", err
		}
		principal, ok = principalFromClientMetadata(client.Metadata, response.ClientID, scopes)
	}
	if !ok {
		return Principal{}, "", &InvalidError{Reason: "OAuth client is not a canonical agent"}
	}
	if err := r.authorize(&principal); err != nil {
		return Principal{}, "", err
	}
	if err := r.requireActiveIdentity(ctx, principal.IdentityID, "OAuth actor is inactive"); err != nil {
		return Principal{}, "", err
	}
	if response.Exp > 0 {
		principal.ExpiresAt = time.Unix(response.Exp, 0)
	}
	return principal, cacheTag("oauth-client", response.ClientID), nil
}

type talosResponse struct {
	ActorID    string                 `json:"actor_id"`
	KeyID      string                 `json:"key_id"`
	IsValid    bool                   `json:"is_valid"`
	ExpireTime string                 `json:"expire_time"`
	Scopes     []string               `json:"scopes"`
	Status     string                 `json:"status"`
	Visibility string                 `json:"visibility"`
	Metadata   map[string]interface{} `json:"metadata"`
}

func (r *Resolver) resolveTalos(ctx context.Context, credential string) (Principal, string, error) {
	body, _ := json.Marshal(map[string]string{"credential": credential})
	var response talosResponse
	if err := r.request(ctx, "talos.verify", http.MethodPost, r.cfg.TalosAdminURL+"/v2alpha1/admin/apiKeys:verify", bytes.NewReader(body), "application/json", &response); err != nil {
		return Principal{}, "", err
	}
	if !response.IsValid || response.ActorID == "" || response.KeyID == "" ||
		(response.Status != "" && response.Status != "KEY_STATUS_ACTIVE" && response.Status != "KEY_STATUS_UNSPECIFIED") ||
		response.Visibility == "KEY_VISIBILITY_PUBLIC" {
		return Principal{}, "", &InvalidError{Reason: "inactive Talos key"}
	}
	if stringValue(response.Metadata["subject_type"]) != SubjectAgent {
		return Principal{}, "", &InvalidError{Reason: "human principals are not allowed"}
	}
	teamID := ""
	if rawTeamID, exists := response.Metadata["team_id"]; exists && rawTeamID != nil {
		var valid bool
		teamID, valid = rawTeamID.(string)
		if !valid {
			return Principal{}, "", &InvalidError{Reason: "invalid Talos team binding"}
		}
	}
	principal := Principal{SubjectType: SubjectAgent, IdentityID: response.ActorID, KeyID: response.KeyID, ClientID: response.KeyID, CredentialType: CredentialTalos, Scopes: normalizeStringScopes(response.Scopes), TeamID: teamID}
	if response.ExpireTime != "" {
		expiresAt, err := time.Parse(time.RFC3339Nano, response.ExpireTime)
		if err != nil || !expiresAt.After(r.cfg.Now()) {
			return Principal{}, "", &InvalidError{Reason: "expired Talos key"}
		}
		principal.ExpiresAt = expiresAt
	}
	if err := r.authorize(&principal); err != nil {
		return Principal{}, "", err
	}
	if err := r.requireActiveIdentity(ctx, response.ActorID, "Talos actor is inactive"); err != nil {
		return Principal{}, "", err
	}
	return principal, cacheTag("talos-key", response.KeyID), nil
}

func (r *Resolver) requireActiveIdentity(ctx context.Context, identityID, reason string) error {
	var identity struct {
		ID    string `json:"id"`
		State string `json:"state"`
	}
	if err := r.request(ctx, "kratos.identity", http.MethodGet, r.cfg.KratosAdminURL+"/admin/identities/"+url.PathEscape(identityID), nil, "", &identity); err != nil {
		return err
	}
	if identity.ID != identityID || identity.State != "active" {
		return &InvalidError{Reason: reason}
	}
	return nil
}

func (r *Resolver) authorize(principal *Principal) error {
	if principal.SubjectType != SubjectAgent || principal.IdentityID == "" {
		return &InvalidError{Reason: "human principals are not allowed"}
	}
	have := make(map[string]struct{}, len(principal.Scopes))
	for _, scope := range principal.Scopes {
		have[scope] = struct{}{}
	}
	for _, required := range r.cfg.RequiredScopes {
		if _, ok := have[required]; !ok {
			return &InvalidError{Reason: "insufficient scope"}
		}
	}
	return nil
}

func (r *Resolver) request(parent context.Context, operation, method, endpoint string, body io.Reader, contentType string, out interface{}) error {
	ctx, cancel := context.WithTimeout(parent, r.cfg.RequestTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, method, strings.TrimRight(endpoint, "/"), body)
	if err != nil {
		return &UnavailableError{Provider: operation, Cause: err}
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	req.Header.Set("Accept", "application/json")
	if r.cfg.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+r.cfg.APIKey)
	}
	if operation == "talos.verify" {
		req.Header.Set("Cache-Control", "no-store")
		req.Header.Set("Pragma", "no-cache")
	}
	started := r.cfg.Now()
	response, err := r.cfg.HTTPClient.Do(req)
	latency := r.cfg.Now().Sub(started)
	if err != nil {
		r.observer.ProviderRequest(parent, operation, "unavailable", latency)
		return &UnavailableError{Provider: operation, Cause: err}
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusTooManyRequests {
		r.observer.ProviderRequest(parent, operation, "rate_limited", latency)
		return &RateLimitedError{Provider: operation}
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		outcome := "unavailable"
		if operation == "oauth2.client_metadata" && response.StatusCode == http.StatusNotFound {
			outcome = "invalid"
		}
		r.observer.ProviderRequest(parent, operation, outcome, latency)
		if outcome == "invalid" {
			return &InvalidError{Reason: "OAuth client metadata not found"}
		}
		return &UnavailableError{Provider: operation, Status: response.StatusCode}
	}
	decoder := json.NewDecoder(io.LimitReader(response.Body, 1<<20))
	if err := decoder.Decode(out); err != nil {
		r.observer.ProviderRequest(parent, operation, "unavailable", latency)
		return &UnavailableError{Provider: operation, Cause: err}
	}
	r.observer.ProviderRequest(parent, operation, "success", latency)
	return nil
}

func flattenClaims(ext map[string]interface{}) map[string]interface{} {
	result := make(map[string]interface{}, len(ext))
	for key, value := range ext {
		result[key] = value
	}
	if nested, ok := ext["ext"].(map[string]interface{}); ok {
		for key, value := range nested {
			result[key] = value
		}
	}
	return result
}

func principalFromClaims(claims map[string]interface{}, clientID string, scopes []string) (Principal, bool) {
	identityID := stringValue(claims["moltnet:identity_id"])
	subjectType := stringValue(claims["moltnet:subject_type"])
	if identityID == "" || subjectType != SubjectAgent {
		return Principal{}, false
	}
	return Principal{SubjectType: SubjectAgent, IdentityID: identityID, ClientID: clientID, CredentialType: CredentialOAuth, Scopes: scopes, TeamID: stringValue(claims["moltnet:team_id"])}, true
}

func principalFromClientMetadata(metadata map[string]interface{}, clientID string, scopes []string) (Principal, bool) {
	if stringValue(metadata["type"]) != "moltnet_agent" {
		return Principal{}, false
	}
	identityID := stringValue(metadata["identity_id"])
	if identityID == "" {
		return Principal{}, false
	}
	return Principal{SubjectType: SubjectAgent, IdentityID: identityID, ClientID: clientID, CredentialType: CredentialOAuth, Scopes: scopes}, true
}

func normalizeScopes(raw json.RawMessage) []string {
	if len(raw) == 0 {
		return nil
	}
	var text string
	if json.Unmarshal(raw, &text) == nil {
		return normalizeStringScopes(strings.Fields(text))
	}
	var values []string
	if json.Unmarshal(raw, &values) == nil {
		return normalizeStringScopes(values)
	}
	return nil
}

func normalizeStringScopes(values []string) []string {
	result := make([]string, 0, len(values))
	seen := make(map[string]struct{})
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || len(value) > 256 {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
		if len(result) == 128 {
			break
		}
	}
	return result
}

func stringValue(value interface{}) string {
	switch typed := value.(type) {
	case string:
		return typed
	case json.Number:
		return typed.String()
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64)
	default:
		return ""
	}
}
