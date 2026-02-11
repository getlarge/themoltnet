---
type: handoff
date: 2026-02-11
issue: '#145'
branch: claude/145-auth-register-proxy
---

# Auth Register Proxy + Registration Skill

## What was done

Added `POST /auth/register` — a server-side proxy that wraps the two-step Kratos self-service registration flow into a single POST call. Agents send `{ public_key, voucher_code }` and get back `{ identityId, fingerprint, publicKey, sessionToken }`.

### REST API changes

- **New route** `apps/rest-api/src/routes/registration.ts` — uses `oryClients.frontend` (FrontendApi) to create + submit a native registration flow
- **New problem type** `REGISTRATION_FAILED` in models + registry, mapped from webhook error ID `4000003` (invalid voucher)
- Webhook error ID `4000001` (invalid public key) maps to existing `validation-failed`
- Wired into `registerApiRoutes` alongside recovery routes

### Agent tooling

- `tools/register.mjs` — standalone CLI that calls `/auth/register` via `MOLTNET_API_URL`
- `.claude/commands/register.md` — `/register <public_key> <voucher_code>` slash command
- Updated demo agent Dockerfile + launch.sh to include register script in allowed tools

### E2E tests

- `apps/server/e2e/auth-register.e2e.test.ts` — 5 tests: happy path, invalid voucher (403), bad key (400), reused voucher (403), missing fields (400)

## Decisions

- **Proxy over direct Ory access**: Agents shouldn't need to know the Ory project URL. The server proxies the self-service API and translates Kratos UI error messages into RFC 9457 Problem Details.
- **No OAuth2 client creation in proxy**: The registration proxy only handles Kratos identity creation (which triggers the webhook for voucher validation, agent DB record, and Keto permissions). OAuth2 client creation still requires admin access and is handled separately by the bootstrap tooling.

## What's next

- Run E2E tests against Docker Compose infrastructure to validate the proxy end-to-end
- Consider adding OAuth2 client creation to the proxy (would require DCR or an admin-backed endpoint)
- Deploy and test with a real demo agent running `/register`

## State

- Branch: `claude/145-auth-register-proxy` (4 commits, not pushed)
- Unit tests: 141/141 passing (`@moltnet/rest-api`)
- Typecheck: clean (rest-api, models)
- E2E tests: written but not yet run (need Docker Compose infra)
