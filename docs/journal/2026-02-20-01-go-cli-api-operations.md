---
date: '2026-02-20T00:00:00Z'
author: claude-sonnet-4-6
session: 220-go-cli-api-ops
type: handoff
importance: 0.85
tags: [cli, go, api-client, oauth2, diary, signing, agents, vouch]
supersedes: null
signature: <pending>
---

# Go CLI: Authenticated API Operations (Issue #220)

## Context

Issue #220 requested extending the Go CLI (`cmd/moltnet`) with authenticated API operations — mirroring what the TypeScript SDK's `Agent` class already provides. The CLI previously only supported registration, local signing, config repair, SSH key export, and git/GitHub setup. Agents using the CLI had no way to interact with the REST API.

## Substance

### What was built

Eight new Go source files in `cmd/moltnet/` (all `package main`, stdlib-only except `golang.org/x/crypto`):

**`token.go`** — `TokenManager` for OAuth2 `client_credentials` flow:
- Caches tokens with early-expiry buffer (default 30s)
- `sync.Mutex` guards cached/expiresAt for concurrent safety
- Dedicated `http.Client{Timeout: 30s}` (not `http.DefaultClient`)
- Posts `scope=openid` as required by Ory Hydra

**`api.go`** — `APIClient` wrapping `TokenManager`:
- `Get`, `Post`, `Delete`, `Patch` methods
- Injects `Authorization: Bearer <token>` on every request
- On 401: calls `tm.Invalidate()`, gets fresh token, retries once
- `apiError` type carries status + body for diagnostic messages

**`agents.go`** — `moltnet agents whoami|lookup`:
- `GET /agents/whoami` — current identity
- `GET /agents/<fingerprint>` — lookup by fingerprint

**`crypto_ops.go`** — `moltnet crypto identity|verify`:
- `GET /crypto/identity` — fetch registered crypto identity
- `POST /crypto/verify` — submit signature for verification

**`vouch.go`** — `moltnet vouch issue|list`:
- `POST /vouch` — issue a new voucher code
- `GET /vouch/active` — list unredeemed vouchers

**`diary.go`** — `moltnet diary create|list|get|delete|search`:
- CRUD + semantic search over diary entries
- `create` accepts `--content` and `--visibility` flags

**`sign.go`** (extended) — `moltnet sign --request-id <id>`:
- New `--request-id` flag triggers `signWithRequestID(client, id, privateKey)`
- Fetches `GET /crypto/signing-requests/<id>`, extracts message+nonce, signs locally, `POST /crypto/signing-requests/<id>/sign`
- Old `--nonce` + positional arg flow preserved for backward compatibility

**`main.go`** (updated) — wires `agents`, `crypto`, `vouch`, `diary` into the switch-case dispatcher and `printUsage()`.

### Tests

67 tests total, all passing with `-race`. New tests:
- `token_test.go`: 5 tests (GetToken, caching, refresh, invalidate, auth-error)
- `api_test.go`: 6 tests (Get, Post, Delete, Patch, non-2xx, 401-retry)
- `agents_test.go`: 2 tests (whoami, lookup)
- `crypto_ops_test.go`: 2 tests (identity, verify)
- `vouch_test.go`: 2 tests (issue, list-active)
- `diary_test.go`: 5 tests (create, list, get, delete, search)
- `sign_test.go`: +1 test (signWithRequestID round-trip with real keypair)

All use `httptest.NewServer` stubs — no live API calls, no new dependencies.

### Commits on `claude/220-go-cli-api-ops`

```
43b6d8c feat(cli): add OAuth2 token manager with caching and invalidation
d7e97b8 fix(cli): add HTTP timeout and fix early expiry fallback in TokenManager
de0e2d8 fix(cli): add scope=openid to token request
fd041ee fix(cli): add mutex to TokenManager for concurrent safety
85a8eaa feat(cli): add APIClient with token injection and 401 retry
f2ef64e feat(cli): add agents, crypto, vouch, diary subcommands with API client
b521635 feat(cli): add --request-id to moltnet sign for one-shot fetch+sign+submit
fc48c67 docs(cli): update CHANGELOG with API operations features
```

### Decisions made

1. **Reuse existing `loadCredentials(path string)`** from `sign.go` rather than introducing a new helper — the existing function already handles default path and nil-check.

2. **`printJSON` lives in `agents.go`** as a package-level helper — all new subcommands use it for consistent JSON output to stdout.

3. **`newDiaryClient` local helper in `diary.go`** — avoids repeating the credential-loading + TokenManager + APIClient construction in each of the 5 diary subcommand runners.

4. **No `signingInput` field used in `--request-id`** — the API's `SigningRequestSchema` doesn't yet expose `signingInput` (that's tracked in issue #251). The current implementation fetches `message` + `nonce` and builds the signing bytes locally via `SignForRequest` (which calls `BuildSigningBytes` internally). Once #251 lands and the API exposes `signingInput`, the `signWithRequestID` function can be updated to skip the local `BuildSigningBytes` call and sign the raw bytes directly.

5. **`testClientPair` helper in `crypto_ops_test.go`** — shared by vouch and crypto tests via the same package. Extracted to reduce duplication.

## What's not done

- **Issue #251** (separate): Add `signingInput` to `SigningRequestSchema`, update MCP tool response, update SDK `signBytes()`, update MCP tool descriptions. This is a sibling issue, not part of #220.
- Diary `update` (PATCH) and visibility/share operations — not in #220 scope, diary covers the core CRUD + search.
- `vouch graph` — not in #220 scope.
- Integration tests against live API — only unit tests with httptest stubs.

## Continuity Notes

- Branch: `claude/220-go-cli-api-ops`
- All 67 tests pass with `-race`
- Binary builds: `go -C cmd/moltnet build -o /tmp/moltnet-test .` verified
- PR ready to create — signal file updated to `ready_for_pr`
- Next: review PR, merge, then issue #251 (signing protocol fix) can reference the `--request-id` flag this adds
