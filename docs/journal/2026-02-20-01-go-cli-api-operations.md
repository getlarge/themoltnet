---
date: '2026-02-20T00:00:00Z'
author: claude-sonnet-4-6
session: 220-go-cli-api-ops
type: handoff
importance: 0.9
tags: [cli, go, api-client, ogen, openapi, oauth2, diary, signing, agents, vouch, release]
supersedes: null
signature: <pending>
---

# Go CLI: Authenticated API Operations + Generated Client Module (Issue #220)

## Context

Issue #220 requested extending the Go CLI (`cmd/moltnet`) with authenticated API operations — mirroring what the TypeScript SDK's `Agent` class already provides. This session took the work significantly further: instead of hand-written HTTP helpers, the implementation uses an ogen-generated client from the OpenAPI spec, hosted as a separate Go module for reuse.

## Substance

### What was built

#### New: `cmd/moltnet-api-client/` — separate Go module

Module path: `github.com/getlarge/themoltnet/cmd/moltnet-api-client`

**`cmd/normalize-spec/main.go`** — Go tool that preprocesses the OpenAPI spec:
- TypeBox generates `anyOf: [{type: "string", enum: ["a"]}, ...]` for enums
- ogen doesn't support this pattern natively
- The normalizer walks the spec and collapses TypeBox-style anyOf enum arrays into standard `{type: "string", enum: ["a", "b", ...]}` objects
- Run via `go run ./cmd/normalize-spec <input> <output>`

**`generate.go`** — `go:generate` directives:
```go
//go:generate go run ./cmd/normalize-spec ../../apps/rest-api/public/openapi.json openapi-normalized.json
//go:generate go run github.com/ogen-go/ogen/cmd/ogen@latest --target . --package moltnetapi --config ogen.yml --clean openapi-normalized.json
```

**`ogen.yml`** — `ignore_not_implemented: ["complex anyOf"]` for residual anyOf patterns

**`oas_*.gen.go`** (19 generated files) — typed client, server stubs, schemas, security source interface. Key types:
- `Client` — typed methods (`GetWhoami`, `CreateDiaryEntry`, `IssueVoucher`, `GetSigningRequest`, `SubmitSignature`, etc.)
- `UnimplementedHandler` — embeddable base for test stubs
- `SecuritySource` interface — `BearerAuth(ctx, operationName) (BearerAuth, error)`
- Typed request/response structs (`DiaryEntry`, `Whoami`, `Voucher`, `SigningRequest`, etc.)

#### CLI changes in `cmd/moltnet/`

**`api.go`** — `tokenSecuritySource` implements `moltnetapi.SecuritySource`:
- `BearerAuth()` delegates to `TokenManager.GetToken()`
- `newAuthedClient(apiURL, tm)` and `newClientFromCreds(apiURL)` helpers

**`agents.go`** — `moltnet agents whoami|lookup`:
- `client.GetWhoami(ctx)` → `*moltnetapi.Whoami`
- `client.GetAgentProfile(ctx, params)` → `*moltnetapi.AgentProfile`

**`crypto_ops.go`** — `moltnet crypto identity|verify`:
- Typed client calls, no manual JSON marshaling

**`vouch.go`** — `moltnet vouch issue|list`:
- `client.IssueVoucher` / `client.ListActiveVouchers`

**`diary.go`** — `moltnet diary create|list|get|delete|search`:
- IDs parsed as `uuid.UUID`; visibility wrapped as `OptCreateDiaryEntryReqVisibility`
- `SearchDiary` uses `OptSearchDiaryReq{Value: SearchDiaryReq{Query: OptString{...}}}`

**`sign.go`** — `moltnet sign --request-id <id>`:
- `signWithRequestID` takes `*moltnetapi.Client`
- Fetches `GetSigningRequest`, submits with `SubmitSignature`

**`main.go`** — wires all new subcommands into the dispatcher.

#### Tests (67 total, all pass with `-race`)

All test files use **ogen-generated server stubs** (`UnimplementedHandler` + `NewServer`):
- `api_test.go` — `newTestServer` helper, `tokenSecuritySource` caching tests
- `agents_test.go` — `stubAgentsHandler`
- `crypto_ops_test.go` — `stubCryptoHandler`
- `vouch_test.go` — `stubVouchHandler`
- `diary_test.go` — `stubDiaryHandler` (all 5 ops; `Importance: 5` required by schema `>= 1` validation)
- `sign_test.go` — `stubSigningHandler` stores submitted sig; test verifies it with `VerifyForRequest`

The ogen server validates handler responses against the spec — caught `Importance: 0` immediately.

#### Versioning & Release

**`release-please-config.json`** — added `cmd/moltnet-api-client` as `release-type: go`, `component: moltnet-api-client`

**`.release-please-manifest.json`** — seeded at `"cmd/moltnet-api-client": "0.1.0"`

**`cmd/moltnet-api-client/CHANGELOG.md`** — initial v0.1.0 entry

**`.github/workflows/release.yml`** changes:
- Added `api-client-release-created`, `api-client-tag-name`, `api-client-version` outputs to `release-please` job
- Added `release-api-client` job: pushes `cmd/moltnet-api-client/vX.Y.Z` Go module proxy tag (required by `go get`) and publishes the GitHub release draft
- `release-cli` now depends on `release-api-client` so the proxy tag exists before goreleaser's before-hook runs
- Passes `API_CLIENT_VERSION` env var to goreleaser

**`cmd/moltnet/.goreleaser.yml`** — `before.hooks` drops the local `replace` directive and pins the versioned api-client from the proxy using `API_CLIENT_VERSION`

### Decisions made

1. **ogen over oapi-codegen** — oapi-codegen fails on OpenAPI 3.1 `anyOf`/`null` types. ogen works with `ignore_not_implemented` + spec normalization.

2. **Separate Go module** (`cmd/moltnet-api-client/`) — allows other Go consumers to `go get github.com/getlarge/themoltnet/cmd/moltnet-api-client` independently of the CLI. CLI references it via `replace` during local dev, dropped at release time.

3. **Go spec normalizer over Python** — user explicitly rejected Python. The Go tool lives in `cmd/normalize-spec/` and is invoked by `go:generate`. No Python dependency.

4. **ogen server stubs for tests** — the generated `UnimplementedHandler + NewServer` enforces spec validation on responses (not just request routing). This is strictly stronger than raw `httptest.NewServer` stubs.

5. **Independent versioning** — CLI and api-client have separate release-please components. The goreleaser hook uses `API_CLIENT_VERSION` (not the CLI semver) so they can diverge over time.

6. **Go module proxy tag format** — the Go toolchain resolves `module@vX.Y.Z` by looking for a git tag `<module-path-suffix>/vX.Y.Z`. For `github.com/getlarge/themoltnet/cmd/moltnet-api-client`, the required tag is `cmd/moltnet-api-client/vX.Y.Z`. release-please creates `moltnet-api-client-vX.Y.Z`; the `release-api-client` job pushes the additional Go proxy tag.

## Current State

- Branch: `claude/220-go-cli-api-ops`
- All 67 tests pass with `-race`
- Binary builds clean: `go -C cmd/moltnet build -o /tmp/moltnet-test .`
- Signal file: `phase=ready_for_pr`

## What's not done

- **Issue #251** — `signingInput` field in `SigningRequestSchema`. The `--request-id` flow works without it by reconstructing the signing bytes locally.
- First manual publish of `moltnet-api-client` to Go module proxy (required before automated releases work). Instructions in CLAUDE.md "Initial publish for new packages" — for Go modules it's a git tag push, not npm publish.
- `go install github.com/getlarge/themoltnet/cmd/moltnet@latest` — the CLI binary also needs a `cmd/moltnet/v*` Go proxy tag for `go install` to work. Not yet wired.

## Where to start next

1. Review and merge this PR
2. After merge: manually push `cmd/moltnet-api-client/v0.1.0` tag to make the Go module publicly resolvable
3. Tackle issue #251 (`signingInput`)
