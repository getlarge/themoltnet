# oryintrospectionauthextension

OpenTelemetry Collector server-side authentication extension that
validates incoming bearer tokens via OAuth 2.0 Token Introspection
(RFC 7662). Designed to gate public OTLP receivers behind Ory Hydra —
both self-hosted (opaque tokens, admin-API introspection with Basic
auth) and Ory Network (opaque tokens, introspection with a Project
API Key as Bearer).

## Why

`oidcauthextension` (the stock OIDC auth extension in opentelemetry-
collector-contrib) only validates JWT signatures locally against JWKS.
Ory Network issues **opaque** access tokens by default, which cannot be
validated without calling the issuer. This extension covers that gap by
always introspecting, so token format (opaque vs JWT) doesn't matter.

## Config

```yaml
extensions:
  oryintrospectionauth:
    introspection_endpoint: 'http://hydra-admin:4445/admin/oauth2/introspect'
    introspection_auth:
      type: 'bearer' # "bearer" | "basic" | "none"
      token: '${env:ORY_PROJECT_API_KEY}'
    required_scopes: ['telemetry:write']
    cache_ttl: 30s
    cache_max_entries: 10000

receivers:
  otlp/public:
    protocols:
      http:
        endpoint: '0.0.0.0:4319'
        auth:
          authenticator: oryintrospectionauth

service:
  extensions: [oryintrospectionauth]
  pipelines:
    traces/public:
      receivers: [otlp/public]
      processors: [batch]
      exporters: [otlp]
```

### `introspection_auth` variants

Mirrors the `IntrospectionAuthConfig` tagged union used by
`@getlarge/fastify-mcp` elsewhere in this codebase:

- **`bearer`** — extension sends `Authorization: Bearer <token>` to Hydra.
  Use with Ory Network Project API Keys or any admin bearer token.
- **`basic`** — extension sends HTTP Basic auth with
  `client_id:client_secret`. RFC 7662 default; use with self-hosted
  Hydra's admin clients.
- **`none`** — no auth header; token is in the form body only. Rare.

## Behavior

1. Extracts `Authorization: Bearer <token>` from incoming request headers.
2. Cache lookup — returns the cached result if within `cache_ttl`.
3. On cache miss: POSTs to `introspection_endpoint` with the token as
   form data. Authenticates itself via `introspection_auth`.
4. On `active: false` or missing required scopes, rejects the request.
5. On success, enriches the downstream context with claims under
   `client.FromContext(ctx).Auth` (readable via
   `AuthData.GetAttribute("sub" | "client_id" | "scope" | "aud" | "iss")`)
   and under `client.FromContext(ctx).Metadata.Get("auth.subject" |
   "auth.client_id" | "auth.scope")`.

## Dev

```bash
# Module lives outside the repo's go.work — use GOWORK=off explicitly.
cd infra/otel/custom-collector/oryintrospectionauthextension
GOWORK=off go test ./...
```

The extension is built into a custom collector image via OCB (see
`../builder.yaml` and `../Dockerfile` — following PRs).

## Known gaps

- **No attribution processor yet**: clients can still send spans tagged
  with any `moltnet.agent.id` — the extension validates tokens but
  doesn't overwrite resource attributes with the authenticated subject.
  Tracked in [#926](https://github.com/getlarge/themoltnet/issues/926)
  as a stretch goal.
- **No rate limiting**: relies on upstream (fly.io, cloudflare) or a
  future processor. A flood of valid tokens will hammer Hydra.
