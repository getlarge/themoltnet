---
date: '2026-02-12T21:30:00Z'
author: claude-opus-4-6
session: c181e912-4101-47eb-9a64-7610484c124f
type: handoff
importance: 0.8
tags: [handoff, ws9, sdk, go-cli, crypto]
supersedes: null
signature: pending
---

# Handoff: Agent SDK and Go CLI — Registration On-Ramp

## What Was Done This Session

- **JS SDK** (`libs/sdk/`): Implemented `@moltnet/sdk` package with register, credentials, MCP config, and error handling. 24 tests passing.
- **Go CLI** (`cmd/moltnet/`): Implemented standalone binary with Ed25519 crypto, HTTP registration, credential storage, and MCP config writing. 15 tests passing. Zero external dependencies.
- **Cross-language crypto vectors** (`test-fixtures/crypto-vectors.json`): 2 deterministic test vectors verified by both JS and Go test suites — ensures identical key derivation, fingerprints, and signatures.
- **api-client exports**: Added `registerAgent`, `rotateClientSecret`, and related types to the main export surface.
- **CI**: Added Go test/build job to `.github/workflows/ci.yml`.
- **Pack check script** (`scripts/check-pack.ts`): Validates publishable packages produce correct tarballs (dist/index.js, dist/index.d.ts present, no src/ leaks). Runs as part of `pnpm validate`.
- **Landing page**: Updated WS9 status from `pending` to `partial`.

## What's Not Done Yet

- SDK doesn't wrap more endpoints yet (whoami, diary, vouchers) — register-only for now
- Go CLI only has `register` subcommand — future: `whoami`, `sign`, `vouch`
- No cross-platform CI for Go binary (only linux/amd64 tested in CI)
- Go binary releases/distribution not set up (no goreleaser, no homebrew tap)
- SDK is publishable but not yet published to npm

## Current State

- Branch: `claude/31-agent-sdk`
- JS tests: 24 passing (SDK) + 8 passing (cross-language vectors in crypto-service)
- Go tests: 15 passing (requires `CGO_ENABLED=0` on macOS ARM64 with Go 1.22)
- Build: clean
- Lint: clean
- Typecheck: clean (pre-existing `tools` failure unrelated)

## Decisions Made

- **SDK exports point to dist/ (not src/)** because it's a publishable package — unlike workspace-internal libs that use source-direct exports
- **Go CLI has zero external deps** — only Go stdlib for crypto, HTTP, JSON, file I/O
- **Single credentials file** (`~/.config/moltnet/credentials.json`) — private key, OAuth2 creds, endpoints all in one file at chmod 600
- **Go stores 32-byte seed, not 64-byte expanded key** — matches the JS convention
- **Pack check runs after build in validate** — lightweight, catches publish issues early

## Open Questions

- Should the SDK re-export `cryptoService` for consumers who want to sign messages?
- When to set up npm publishing pipeline (manual vs CI)?
- Go binary distribution strategy: goreleaser + GitHub releases? Homebrew tap?

## Where to Start Next

1. Read this handoff entry
2. Read `docs/FREEDOM_PLAN.md` WS9 section for remaining SDK scope
3. Extend SDK with more API wrappers (diary, vouchers, whoami)
4. Add more Go CLI subcommands (`whoami`, `sign`, `vouch`)
5. Set up npm publish workflow once the API is stable
