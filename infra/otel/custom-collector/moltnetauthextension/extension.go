package moltnetauthextension

import (
	"context"
	"errors"
	"strings"
	"time"

	authn "github.com/getlarge/themoltnet/libs/moltnet-authn"
	"go.opentelemetry.io/collector/client"
	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/extension"
	"go.opentelemetry.io/collector/extension/extensionauth"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	"go.uber.org/zap"
)

type authExtension struct {
	cfg       *Config
	logger    *zap.Logger
	resolver  *authn.Resolver
	limiter   *boundedLimiter
	throttled metric.Int64Counter
	rejected  metric.Int64Counter
}

func newExtension(cfg *Config, settings extension.Settings) (*authExtension, error) {
	meter := settings.MeterProvider.Meter("github.com/getlarge/themoltnet/infra/otel/moltnetauth")
	observer, err := newMetricObserver(meter)
	if err != nil {
		return nil, err
	}
	throttled, err := meter.Int64Counter("moltnet.auth.throttled.requests", metric.WithDescription("Rejected public OTLP requests by limiter stage"))
	if err != nil {
		return nil, err
	}
	rejected, err := meter.Int64Counter("moltnet.auth.rejected.requests", metric.WithDescription("Rejected public OTLP authentication attempts by bounded reason"))
	if err != nil {
		return nil, err
	}
	resolver, err := authn.NewResolver(authn.Config{ProjectURL: cfg.ProjectURL, APIKey: cfg.APIKey, HydraAdminURL: cfg.HydraAdminURL, TalosAdminURL: cfg.TalosAdminURL, KratosAdminURL: cfg.KratosAdminURL, RequiredScopes: cfg.RequiredScopes, CacheTTL: *cfg.CacheTTL, CacheMaxEntries: *cfg.CacheMaxEntries, RequestTimeout: *cfg.RequestTimeout}, observer)
	if err != nil {
		return nil, err
	}
	return &authExtension{cfg: cfg, logger: settings.Logger, resolver: resolver, limiter: newBoundedLimiter(cfg), throttled: throttled, rejected: rejected}, nil
}
func (a *authExtension) Start(context.Context, component.Host) error {
	a.logger.Info("MoltNet public OTLP authentication started", zap.Strings("required_scopes", a.cfg.RequiredScopes))
	return nil
}
func (a *authExtension) Shutdown(context.Context) error { return nil }

func (a *authExtension) Authenticate(ctx context.Context, headers map[string][]string) (context.Context, error) {
	if !a.limiter.allowGlobal() {
		a.throttled.Add(ctx, 1, metric.WithAttributes(attribute.String("stage", "pre_auth")))
		err := &authn.RateLimitedError{Provider: "public_ingress"}
		a.recordRejection(ctx, "pre_auth_rate_limited", err)
		return ctx, err
	}
	credential, err := extractBearer(headers)
	if err != nil {
		a.recordRejection(ctx, rejectionReason(err), err)
		return ctx, err
	}
	principal, err := a.resolver.Resolve(ctx, credential)
	if err != nil {
		a.recordRejection(ctx, rejectionReason(err), err)
		return ctx, err
	}
	if !a.limiter.allowAgent(principal.IdentityID) {
		a.throttled.Add(ctx, 1, metric.WithAttributes(attribute.String("stage", "agent")))
		err := &authn.RateLimitedError{Provider: "agent_ingress"}
		a.recordRejection(ctx, "agent_rate_limited", err)
		return ctx, err
	}
	info := client.FromContext(ctx)
	info.Metadata = client.NewMetadata(map[string][]string{"auth.subject_type": {principal.SubjectType}, "auth.identity_id": {principal.IdentityID}, "auth.credential_type": {principal.CredentialType}})
	info.Auth = principalAuth{principal: principal}
	return client.NewContext(ctx, info), nil
}

func (a *authExtension) recordRejection(ctx context.Context, reason string, err error) {
	if a.rejected != nil {
		a.rejected.Add(ctx, 1, metric.WithAttributes(attribute.String("reason", reason)))
	}
	var rateLimited *authn.RateLimitedError
	var unavailable *authn.UnavailableError
	if a.logger != nil && (errors.As(err, &rateLimited) || errors.As(err, &unavailable)) {
		a.logger.Warn("MoltNet public OTLP authentication rejected", zap.String("reason", reason))
	}
}

func rejectionReason(err error) string {
	switch {
	case errors.Is(err, errMissingAuthorization):
		return "missing_authorization"
	case errors.Is(err, errMalformedAuthorization):
		return "malformed_authorization"
	}
	var invalid *authn.InvalidError
	if errors.As(err, &invalid) {
		if invalid.Reason == "insufficient scope" {
			return "insufficient_scope"
		}
		return "invalid_credential"
	}
	var rateLimited *authn.RateLimitedError
	if errors.As(err, &rateLimited) {
		return "provider_rate_limited"
	}
	var unavailable *authn.UnavailableError
	if errors.As(err, &unavailable) {
		return "provider_unavailable"
	}
	return "authentication_error"
}

var (
	errMissingAuthorization   = errors.New("missing Authorization header")
	errMalformedAuthorization = errors.New(`Authorization header must be "Bearer <credential>"`)
)

func extractBearer(headers map[string][]string) (string, error) {
	for key, values := range headers {
		if !strings.EqualFold(key, "authorization") || len(values) != 1 {
			continue
		}
		parts := strings.Fields(values[0])
		if len(parts) == 2 && strings.EqualFold(parts[0], "bearer") && parts[1] != "" {
			return parts[1], nil
		}
		return "", errMalformedAuthorization
	}
	return "", errMissingAuthorization
}

type principalAuth struct{ principal authn.Principal }

func (a principalAuth) GetAttribute(name string) any {
	switch name {
	case "sub", "subject", authn.IdentityIDAttribute:
		return a.principal.IdentityID
	case "subject_type":
		return a.principal.SubjectType
	case "client_id":
		return a.principal.ClientID
	case "key_id":
		return a.principal.KeyID
	case "credential_type":
		return a.principal.CredentialType
	case "scope":
		return strings.Join(a.principal.Scopes, " ")
	case "team_id":
		return a.principal.TeamID
	default:
		return nil
	}
}
func (a principalAuth) GetAttributeNames() []string {
	return []string{"sub", "subject", authn.IdentityIDAttribute, "subject_type", "client_id", "key_id", "credential_type", "scope", "team_id"}
}

type metricObserver struct {
	provider  metric.Int64Counter
	latency   metric.Float64Histogram
	cache     metric.Int64Counter
	evictions metric.Int64Counter
}

func newMetricObserver(meter metric.Meter) (*metricObserver, error) {
	provider, err := meter.Int64Counter("moltnet.auth.provider.requests")
	if err != nil {
		return nil, err
	}
	latency, err := meter.Float64Histogram("moltnet.auth.provider.duration", metric.WithUnit("s"))
	if err != nil {
		return nil, err
	}
	cache, err := meter.Int64Counter("moltnet.auth.cache.accesses")
	if err != nil {
		return nil, err
	}
	evictions, err := meter.Int64Counter("moltnet.auth.cache.evictions")
	if err != nil {
		return nil, err
	}
	return &metricObserver{provider: provider, latency: latency, cache: cache, evictions: evictions}, nil
}
func (o *metricObserver) ProviderRequest(ctx context.Context, operation, outcome string, latencyDuration time.Duration) {
	attrs := metric.WithAttributes(attribute.String("operation", operation), attribute.String("outcome", outcome))
	o.provider.Add(ctx, 1, attrs)
	o.latency.Record(ctx, latencyDuration.Seconds(), attrs)
}
func (o *metricObserver) CacheAccess(ctx context.Context, credentialType, result string) {
	o.cache.Add(ctx, 1, metric.WithAttributes(attribute.String("credential_type", credentialType), attribute.String("result", result)))
}
func (o *metricObserver) CacheEviction(ctx context.Context, reason string) {
	o.evictions.Add(ctx, 1, metric.WithAttributes(attribute.String("reason", reason)))
}

var _ extensionauth.Server = (*authExtension)(nil)
var _ component.Component = (*authExtension)(nil)
