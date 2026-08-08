package moltnetauthn

import (
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

	ory "github.com/ory/client-go"
)

type Resolver struct {
	cfg          Config
	observer     Observer
	cache        *authCache
	hydraClient  *ory.APIClient
	talosClient  *ory.APIClient
	kratosClient *ory.APIClient
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
	r := &Resolver{
		cfg:          cfg,
		observer:     observer,
		hydraClient:  newOryClient(cfg.HydraAdminURL, cfg),
		talosClient:  newOryClient(cfg.TalosAdminURL, cfg),
		kratosClient: newOryClient(cfg.KratosAdminURL, cfg),
	}
	r.cache = newAuthCache(cfg, observer)
	return r, nil
}

const maxProviderResponseBytes = 1 << 20

type limitedResponseBody struct {
	io.Reader
	io.Closer
}

type limitedResponseTransport struct{ base http.RoundTripper }

func (t limitedResponseTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	response, err := t.base.RoundTrip(req)
	if err != nil || response == nil || response.Body == nil {
		return response, err
	}
	response.Body = limitedResponseBody{
		Reader: io.LimitReader(response.Body, maxProviderResponseBytes),
		Closer: response.Body,
	}
	return response, nil
}

func newOryClient(baseURL string, cfg Config) *ory.APIClient {
	httpClient := *cfg.HTTPClient
	transport := httpClient.Transport
	if transport == nil {
		transport = http.DefaultTransport
	}
	httpClient.Transport = limitedResponseTransport{base: transport}

	oryConfig := ory.NewConfiguration()
	oryConfig.Servers = ory.ServerConfigurations{{URL: baseURL}}
	oryConfig.HTTPClient = &httpClient
	if cfg.APIKey != "" {
		oryConfig.AddDefaultHeader("Authorization", "Bearer "+cfg.APIKey)
	}
	return ory.NewAPIClient(oryConfig)
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

func (r *Resolver) resolveOAuth(ctx context.Context, credential string) (Principal, string, error) {
	response, err := executeProviderRequest(r, ctx, "oauth2.introspect", func(requestCtx context.Context) (*ory.IntrospectedOAuth2Token, *http.Response, error) {
		return r.hydraClient.OAuth2API.IntrospectOAuth2Token(requestCtx).Token(credential).Execute()
	})
	if err != nil {
		return Principal{}, "", err
	}
	clientID := response.GetClientId()
	if !response.Active || clientID == "" {
		return Principal{}, "", &InvalidError{Reason: "inactive OAuth token"}
	}
	expiresAt := response.GetExp()
	if expiresAt > 0 && !time.Unix(expiresAt, 0).After(r.cfg.Now()) {
		return Principal{}, "", &InvalidError{Reason: "expired OAuth token"}
	}
	scopes := normalizeScopes(response.Scope)
	claims := flattenClaims(response.Ext)
	principal, ok := principalFromClaims(claims, clientID, scopes)
	claimsPresent := stringValue(claims["moltnet:identity_id"]) != "" || stringValue(claims["moltnet:subject_type"]) != ""
	if claimsPresent && !ok {
		return Principal{}, "", &InvalidError{Reason: "OAuth claims do not identify a canonical agent"}
	}
	if !claimsPresent {
		client, requestErr := executeProviderRequest(r, ctx, "oauth2.client_metadata", func(requestCtx context.Context) (*ory.OAuth2Client, *http.Response, error) {
			return r.hydraClient.OAuth2API.GetOAuth2Client(requestCtx, clientID).Execute()
		})
		if requestErr != nil {
			var invalid *InvalidError
			if errors.As(requestErr, &invalid) {
				return Principal{}, "", invalid
			}
			return Principal{}, "", requestErr
		}
		principal, ok = principalFromClientMetadata(client.Metadata, clientID, scopes)
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
	if expiresAt > 0 {
		principal.ExpiresAt = time.Unix(expiresAt, 0)
	}
	return principal, cacheTag("oauth-client", clientID), nil
}

func (r *Resolver) resolveTalos(ctx context.Context, credential string) (Principal, string, error) {
	request := ory.NewVerifyApiKeyRequest()
	request.SetCredential(credential)
	response, err := executeProviderRequest(r, ctx, "talos.verify", func(requestCtx context.Context) (*ory.VerifyApiKeyResponse, *http.Response, error) {
		return r.talosClient.ApiKeysAPI.AdminVerifyApiKey(requestCtx).
			VerifyApiKeyRequest(*request).
			CacheControl("no-store").
			Pragma("no-cache").
			Execute()
	})
	if err != nil {
		return Principal{}, "", err
	}
	actorID := response.GetActorId()
	keyID := response.GetKeyId()
	status := response.GetStatus()
	visibility := response.GetVisibility()
	if !response.GetIsValid() || actorID == "" || keyID == "" ||
		(status != ory.KEYSTATUS_KEY_STATUS_ACTIVE && status != ory.KEYSTATUS_KEY_STATUS_UNSPECIFIED) ||
		visibility == ory.KEYVISIBILITY_KEY_VISIBILITY_PUBLIC {
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
	principal := Principal{SubjectType: SubjectAgent, IdentityID: actorID, KeyID: keyID, ClientID: keyID, CredentialType: CredentialTalos, Scopes: normalizeStringScopes(response.Scopes), TeamID: teamID}
	if response.ExpireTime != nil {
		if !response.ExpireTime.After(r.cfg.Now()) {
			return Principal{}, "", &InvalidError{Reason: "expired Talos key"}
		}
		principal.ExpiresAt = *response.ExpireTime
	}
	if err := r.authorize(&principal); err != nil {
		return Principal{}, "", err
	}
	if err := r.requireActiveIdentity(ctx, actorID, "Talos actor is inactive"); err != nil {
		return Principal{}, "", err
	}
	return principal, cacheTag("talos-key", keyID), nil
}

func (r *Resolver) requireActiveIdentity(ctx context.Context, identityID, reason string) error {
	identity, err := executeProviderRequest(r, ctx, "kratos.identity", func(requestCtx context.Context) (*ory.Identity, *http.Response, error) {
		return r.kratosClient.IdentityAPI.GetIdentity(requestCtx, identityID).Execute()
	})
	if err != nil {
		return err
	}
	if identity.Id != identityID || identity.GetState() != "active" {
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

func executeProviderRequest[T any](r *Resolver, parent context.Context, operation string, execute func(context.Context) (*T, *http.Response, error)) (*T, error) {
	ctx, cancel := context.WithTimeout(parent, r.cfg.RequestTimeout)
	defer cancel()
	started := r.cfg.Now()
	result, response, err := execute(ctx)
	latency := r.cfg.Now().Sub(started)
	if response != nil && response.StatusCode == http.StatusTooManyRequests {
		r.observer.ProviderRequest(parent, operation, "rate_limited", latency)
		return nil, &RateLimitedError{Provider: operation}
	}
	if response != nil && (response.StatusCode < 200 || response.StatusCode >= 300) {
		outcome := "unavailable"
		if operation == "oauth2.client_metadata" && response.StatusCode == http.StatusNotFound {
			outcome = "invalid"
		}
		r.observer.ProviderRequest(parent, operation, outcome, latency)
		if outcome == "invalid" {
			return nil, &InvalidError{Reason: "OAuth client metadata not found"}
		}
		return nil, &UnavailableError{Provider: operation, Status: response.StatusCode}
	}
	if err != nil {
		r.observer.ProviderRequest(parent, operation, "unavailable", latency)
		if response != nil {
			return nil, &UnavailableError{Provider: operation, Cause: errors.New("invalid provider response")}
		}
		return nil, &UnavailableError{Provider: operation, Cause: err}
	}
	if result == nil {
		r.observer.ProviderRequest(parent, operation, "unavailable", latency)
		return nil, &UnavailableError{Provider: operation, Cause: errors.New("empty provider response")}
	}
	r.observer.ProviderRequest(parent, operation, "success", latency)
	return result, nil
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

func normalizeScopes(raw *string) []string {
	if raw == nil {
		return nil
	}
	return normalizeStringScopes(strings.Fields(*raw))
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
