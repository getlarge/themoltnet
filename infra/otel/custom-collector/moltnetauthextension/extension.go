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
	resolver, err := authn.NewResolver(authn.Config{ProjectURL: cfg.ProjectURL, APIKey: cfg.APIKey, HydraAdminURL: cfg.HydraAdminURL, TalosAdminURL: cfg.TalosAdminURL, KratosAdminURL: cfg.KratosAdminURL, RequiredScopes: cfg.RequiredScopes, CacheTTL: *cfg.CacheTTL, CacheMaxEntries: *cfg.CacheMaxEntries, RequestTimeout: *cfg.RequestTimeout}, observer)
	if err != nil {
		return nil, err
	}
	return &authExtension{cfg: cfg, logger: settings.Logger, resolver: resolver, limiter: newBoundedLimiter(cfg), throttled: throttled}, nil
}
func (a *authExtension) Start(context.Context, component.Host) error {
	a.logger.Info("MoltNet public OTLP authentication started", zap.Strings("required_scopes", a.cfg.RequiredScopes))
	return nil
}
func (a *authExtension) Shutdown(context.Context) error { return nil }

func (a *authExtension) Authenticate(ctx context.Context, headers map[string][]string) (context.Context, error) {
	if !a.limiter.allowGlobal() {
		a.throttled.Add(ctx, 1, metric.WithAttributes(attribute.String("stage", "pre_auth")))
		return ctx, errors.New("public OTLP request rate limited")
	}
	credential, err := extractBearer(headers)
	if err != nil {
		return ctx, err
	}
	principal, err := a.resolver.Resolve(ctx, credential)
	if err != nil {
		return ctx, err
	}
	if !a.limiter.allowAgent(principal.IdentityID) {
		a.throttled.Add(ctx, 1, metric.WithAttributes(attribute.String("stage", "agent")))
		return ctx, errors.New("public OTLP agent rate limited")
	}
	info := client.FromContext(ctx)
	info.Metadata = client.NewMetadata(map[string][]string{"auth.subject_type": {principal.SubjectType}, "auth.identity_id": {principal.IdentityID}, "auth.credential_type": {principal.CredentialType}})
	info.Auth = principalAuth{principal: principal}
	return client.NewContext(ctx, info), nil
}

func extractBearer(headers map[string][]string) (string, error) {
	for key, values := range headers {
		if !strings.EqualFold(key, "authorization") || len(values) != 1 {
			continue
		}
		parts := strings.Fields(values[0])
		if len(parts) == 2 && strings.EqualFold(parts[0], "bearer") && parts[1] != "" {
			return parts[1], nil
		}
		return "", errors.New(`Authorization header must be "Bearer <credential>"`)
	}
	return "", errors.New("missing Authorization header")
}

type principalAuth struct{ principal authn.Principal }

func (a principalAuth) GetAttribute(name string) any {
	switch name {
	case "sub", "subject", "moltnet.identity_id":
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
	return []string{"sub", "subject", "moltnet.identity_id", "subject_type", "client_id", "key_id", "credential_type", "scope", "team_id"}
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
