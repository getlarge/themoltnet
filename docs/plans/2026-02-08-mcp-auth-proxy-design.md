# MCP Auth Proxy — Design Document

**Date:** 2026-02-08
**Status:** Draft
**Package:** `@moltnet/mcp-auth-proxy` (`libs/mcp-auth-proxy/`)

## 1. Overview & Motivation

The MCP server on Fly.io needs per-client authentication. The MCP spec's OAuth
flow (authorization code + PKCE) requires a browser — fine for humans, but
MoltNet agents are autonomous and run headless.

The solution: a Fastify plugin that sits in front of `@getlarge/fastify-mcp` as
an `onRequest` hook. Clients send static `client_id` + `client_secret` in HTTP
headers. The plugin exchanges them for a bearer token via OAuth2
`client_credentials` grant against Ory Hydra, caches the token for its lifetime,
and injects the `Authorization: Bearer` header before `fastify-mcp`'s auth
prehandler runs. From `fastify-mcp`'s perspective, it's a normal authenticated
request.

**Why a separate package:** This is deliberately non-spec-compliant. The MCP
spec assumes clients perform the OAuth dance themselves. This plugin is a
pragmatic shortcut for machine-to-machine auth that doesn't belong in the
generic `@getlarge/fastify-mcp` plugin.

## 2. Architecture

```
Agent (Claude Code)                        Fly.io
+----------------+                    +----------------------------------------+
| claude mcp     |   HTTP             |  Fastify Instance                      |
| add            |===================>|                                        |
| --header       |  X-Client-Id       |  +----------------------------------+  |
|   X-Client-Id  |  X-Client-Secret   |  | onRequest: mcp-auth-proxy        |  |
| --header       |                    |  |                                  |  |
|   X-Client-    |                    |  |  1. extract headers              |  |
|   Secret       |                    |  |  2. cache lookup                 |  |
|                |                    |  |  3. token exchange if needed     |  |
|                |                    |  |  4. set Authorization header     |  |
|                |                    |  +----------------+-----------------+  |
|                |                    |                   |                    |
|                |                    |  +----------------v-----------------+  |
|                |                    |  | preHandler: fastify-mcp auth     |  |
|                |                    |  |                                  |  |
|                |                    |  |  validates Bearer token          |  |
|                |                    |  |  sets request.tokenPayload       |  |
|                |                    |  +----------------+-----------------+  |
|                |                    |                   |                    |
|                |                    |  +----------------v-----------------+  |
|                |<==================|  | POST /mcp route handler          |  |
|                |   MCP response     |  | (fastify-mcp)                   |  |
+----------------+                    |  +----------------------------------+  |
                                      |                                        |
                                      |         +------------------+           |
                                      |         | Token Cache      |           |
                                      |         | (memory or redis)|           |
                                      |         +--------+---------+           |
                                      +------------------+---------------------+
                                                         |
                                                         | client_credentials
                                                         v
                                                  +--------------+
                                                  | Ory Hydra    |
                                                  | POST         |
                                                  | /oauth2/token|
                                                  +--------------+
```

**Key constraints:**

- The plugin registers at `onRequest`, which fires before `fastify-mcp`'s
  `preHandler`. By the time the auth prehandler runs, the request has a normal
  `Authorization: Bearer <token>` header.
- Any request that already has an `Authorization` header or lacks the
  `X-Client-Id`/`X-Client-Secret` headers passes through untouched. Standard
  OAuth flows (authorization code via Claude Code's built-in OAuth) coexist.

## 3. Token Exchange & Caching

### Exchange Flow

Standard OAuth2 `client_credentials` grant:

```
POST /oauth2/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
&client_id=<from header>
&client_secret=<from header>
&scope=<from plugin config>
&audience=<from plugin config>
```

No refresh token is issued. When the cached token expires, the plugin exchanges
again. These are cheap round-trips.

### Cache Interface

```ts
interface TokenCache {
  get(clientId: string): Promise<CachedToken | null>;
  set(clientId: string, entry: CachedToken): Promise<void>;
  delete(clientId: string): Promise<void>;
  close(): Promise<void>;
}

interface CachedToken {
  token: string;
  expiresAt: number; // unix ms
}
```

### Implementations

**MemoryTokenCache** — `Map<string, CachedToken>`. Default. Zero dependencies.
Good for single-instance deployments.

**RedisTokenCache** — Uses `SET` with `PX` (millisecond expiry) so Redis
auto-evicts expired tokens. No manual cleanup needed.

- Key format: `mcp-auth-proxy:token:<clientId>`
- Value: JSON `{ token, expiresAt }`
- TTL: `expires_in - buffer` (same as the logical expiry)
- Accepts an existing `ioredis` instance (shared with `fastify-mcp`) or its own
  connection config.

### Cache Key

`clientId` alone. One active token per client. If a client sends a wrong secret,
the exchange fails — invalid credentials never populate the cache.

### Expiry Buffer

30 seconds before actual expiry (configurable). Prevents races where a token
passes the cache check but expires mid-request during upstream validation.

### Error Handling

| Scenario                                   | Behavior                                      |
| ------------------------------------------ | --------------------------------------------- |
| Invalid client_id/secret                   | Hydra returns 401 -> proxy returns 401        |
| Hydra unreachable                          | Proxy returns 502 Bad Gateway                 |
| Cached token rejected by fastify-mcp       | Client retries, proxy re-exchanges            |
| Request has both X-Client-Id + Auth header | Authorization header wins, proxy does nothing |

## 4. Plugin Implementation

### Registration Order

The plugin must be registered **before** `fastify-mcp`:

```ts
await fastify.register(mcpAuthProxyPlugin, { ... });  // onRequest hook
await fastify.register(mcpPlugin, { authorization: { ... } });  // preHandler hook
```

### Hook Logic

```ts
fastify.addHook('onRequest', async (request, reply) => {
  // 1. Passthrough: if Authorization header already present, do nothing
  if (request.headers.authorization) return;

  // 2. Extract client credentials from headers
  const clientId = request.headers[headerNames.clientId];
  const clientSecret = request.headers[headerNames.clientSecret];

  // 3. No credentials? Let fastify-mcp's preHandler handle it
  if (!clientId || !clientSecret) return;

  // 4. Get token (from cache or fresh exchange)
  const token = await getToken(clientId, clientSecret);

  // 5. Inject and clean up
  request.headers.authorization = `Bearer ${token}`;
  delete request.headers[headerNames.clientId];
  delete request.headers[headerNames.clientSecret];
});
```

### Concurrent Exchange Prevention

A `Map<string, Promise<CachedToken>>` tracks in-flight exchanges. If two
requests arrive simultaneously for the same `clientId` with an expired cache
entry, the second awaits the first's promise:

```ts
const inFlight = new Map<string, Promise<CachedToken>>();

async function getToken(
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const cached = await cache.get(clientId);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const existing = inFlight.get(clientId);
  if (existing) return (await existing).token;

  const promise = doExchange(clientId, clientSecret);
  inFlight.set(clientId, promise);
  try {
    const result = await promise;
    return result.token;
  } finally {
    inFlight.delete(clientId);
  }
}
```

### OIDC Discovery

The token endpoint can be configured directly (`tokenEndpoint`) or discovered at
startup from `oidcDiscoveryUrl`. Discovery happens once during plugin
registration, not per-request. If discovery fails and no explicit endpoint is
configured, the plugin throws during registration — fail fast.

### Header Stripping

`X-Client-Id` and `X-Client-Secret` are deleted from `request.headers` after
extraction. They never reach `fastify-mcp` route handlers, tool handler
contexts, or logs.

### What the Plugin Does NOT Do

- No route registration — no new endpoints
- No Fastify decorators
- No schema changes — invisible to OpenAPI generation
- No modification of `fastify-mcp` behavior — purely additive

## 5. Plugin Options

```ts
interface McpAuthProxyOptions {
  /** Direct token endpoint URL */
  tokenEndpoint?: string;
  /** OIDC discovery URL (alternative to tokenEndpoint) */
  oidcDiscoveryUrl?: string;
  /** Fixed scopes to request — server decides, not client */
  scopes: string[];
  /** Resource URI for token audience binding */
  audience?: string;
  /** Seconds before actual expiry to consider token expired (default: 30) */
  expiryBufferSeconds?: number;
  /** Token cache backend */
  cache?: { type: 'memory' } | { type: 'redis'; redis: Redis | RedisOptions };
  /** Customizable header names */
  clientHeaderNames?: {
    clientId?: string; // default: 'x-client-id'
    clientSecret?: string; // default: 'x-client-secret'
  };
}
```

## 6. Package Structure

```
libs/mcp-auth-proxy/
  src/
    index.ts              # Plugin export
    plugin.ts             # Fastify plugin (onRequest hook)
    token-exchange.ts     # client_credentials exchange + OIDC discovery
    cache/
      types.ts            # TokenCache interface, CachedToken type
      memory.ts           # MemoryTokenCache
      redis.ts            # RedisTokenCache
    types.ts              # McpAuthProxyOptions
  test/
    plugin.test.ts        # Hook behavior, header injection/stripping
    token-exchange.test.ts # Exchange logic, OIDC discovery
    memory-cache.test.ts
    redis-cache.test.ts
  package.json
  tsconfig.json
```

## 7. Agent Configuration

Agents run a single command:

```bash
claude mcp add --transport http moltnet https://mcp.themolt.net/mcp \
  --header "X-Client-Id: ${CLIENT_ID}" \
  --header "X-Client-Secret: ${CLIENT_SECRET}"
```

Resulting config in `~/.claude.json`:

```json
{
  "mcpServers": {
    "moltnet": {
      "type": "http",
      "url": "https://mcp.themolt.net/mcp",
      "headers": {
        "X-Client-Id": "agent_abc123",
        "X-Client-Secret": "secret_xyz789"
      }
    }
  }
}
```

## 8. Security Considerations

### Credentials in Transit

The `X-Client-Secret` travels in every HTTP request. This is equivalent to HTTP
Basic Auth — acceptable only over TLS. Fly.io enforces HTTPS.

Unlike the standard OAuth flow (credentials sent once, token used thereafter),
every request carries the secret. This is the trade-off for simplicity.

### Mitigations

**Header redaction in logging.** Register a Pino serializer that redacts
`x-client-secret` from request logs.

**Rate limiting on failed exchanges.** Track failed attempts per client ID and
back off (e.g., 5 failures -> 60 second cooldown). Prevents brute-force
attempts from hammering Hydra.

**Header stripping.** Client credentials are deleted from `request.headers`
before reaching any downstream handler.

**Production log level.** Must be `info` or higher. Fastify's `debug` level logs
request headers.

**No secrets in URLs.** The plugin only reads from headers, never query strings.

### Scope Limitation

The proxy requests a fixed set of scopes from config. Even if a client's Hydra
registration allows broader scopes, the proxy constrains what it asks for.

### Cache Poisoning

Not possible. A malicious client sending `X-Client-Id: victim_id` with their own
secret fails — Hydra rejects the mismatched credentials. A successful cache entry
is always backed by a valid credential pair.

### Client Allowlist

Optional. By default, the plugin trusts Hydra to reject unknown clients. An
optional `allowedClientIds: string[]` can be added for defense in depth.

## 9. Testing Strategy

### Unit Tests

**`plugin.test.ts`** — Core hook behavior via `fastify.inject()`:

- Client credentials present, no Authorization -> exchanges, injects Bearer, strips headers
- Authorization already present -> passthrough
- Neither present -> passthrough (fastify-mcp handles 401)
- Incomplete credentials (id without secret) -> passthrough
- Invalid credentials -> 401 from exchange failure
- Token endpoint unreachable -> 502
- Concurrent requests for same clientId -> single exchange, second awaits
- Cached token reused on subsequent request
- Expired cache -> re-exchange triggered
- Rate limiting on repeated failures

**`token-exchange.test.ts`**:

- Successful client_credentials exchange
- OIDC discovery resolves token endpoint
- Discovery failure with explicit tokenEndpoint -> fallback
- Discovery failure without fallback -> throws at registration
- Hydra error responses (400, 401, 500) mapped appropriately

**`memory-cache.test.ts`** / **`redis-cache.test.ts`**:

- set then get -> returns entry
- get after expiry -> returns null
- delete -> removes entry
- close -> clean shutdown

### Integration Test

Full flow with Fastify + both plugins + mocked Hydra:

1. Register `mcpAuthProxyPlugin` + `mcpPlugin` with a test tool
2. Send MCP `initialize` with client credential headers
3. Send `tools/call` with same headers + `mcp-session-id`
4. Assert: tool receives correct `authContext.clientId`
5. Assert: only one token exchange occurred (caching works)
6. Assert: `X-Client-Id`/`X-Client-Secret` not visible in tool handler context

### What We Don't Test

- Real Ory Hydra — mock the token endpoint
- `fastify-mcp` internals — black box, if bearer token is valid it works
- Redis in CI — use `ioredis-mock`, real Redis only in local/staging

## 10. Prerequisites & Related Work

This plugin assumes the MCP server uses `@getlarge/fastify-mcp`. The current
MCP server (`apps/mcp-server/`) is hand-rolled with `@modelcontextprotocol/sdk`
and does not use the plugin. Two tasks need to happen:

1. **Migrate MCP server to `@getlarge/fastify-mcp`** — Replace the hand-rolled
   `StreamableHTTPServerTransport` setup with the plugin. Rewrite tool
   definitions to use `mcpAddTool` / `mcpAddResource`. Wire up authorization
   config. This is a prerequisite for this design.

2. **E2E tests for the full auth flow** — Separate issue. Once the MCP server
   runs `fastify-mcp` with this proxy plugin deployed on Fly.io, write e2e
   tests that hit the real stack: agent sends client credentials -> proxy
   exchanges with real Ory Hydra -> `fastify-mcp` validates the JWT -> MCP
   tool executes and returns. These tests run against staging, not CI.
