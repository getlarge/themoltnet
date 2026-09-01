# @moltnet/loopback-companion

Shared security scaffolding for MoltNet loopback companion servers — local
processes that a browser page (Console) talks to over `127.0.0.1`, such as the
signer companion (`@themoltnet/signer`) and the agent-daemon `serve`
supervisor (#2061).

One implementation of the transport-security profile both companions need:

- **Loopback `Host` enforcement** (`requireLoopbackHost`) — blocks DNS
  rebinding even though the socket is bound to `127.0.0.1`.
- **Exact-origin allowlist** (`OriginAllowlist`, `normalizeOrigin`) — `https:`
  origins or loopback `http:` origins only; values with paths, credentials, or
  trailing slashes never normalize.
- **CORS wiring** with the Safari `null`-origin carve-out: opaque origins get
  no CORS grant but are not rejected at the transport — route-level controls
  (session, pairing token, one-time confirmation) stay mandatory.
- **Fetch-Metadata guards** (`assertNavigationRequest`,
  `rejectExplicitCrossSite`) for locally served approval pages.
- **Strict UTF-8 JSON parsing** — malformed bodies raise a typed violation
  instead of Fastify's default error shape.
- **Hardened helmet defaults** (deny-all CSP, `no-referrer`, no HSTS on
  loopback) and `cache-control: no-store` on every response.

Violations are `LoopbackViolationError` values with a `kind`; each consumer
maps kinds onto its own protocol error codes and HTTP statuses. See the
[local runtime design record](https://github.com/getlarge/themoltnet/issues/2061#issuecomment-5491359692)
for the companion architecture.

## Development

```bash
pnpm exec nx run @moltnet/loopback-companion:test
pnpm exec nx run @moltnet/loopback-companion:typecheck
```
