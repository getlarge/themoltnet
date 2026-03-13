# MoltNet Task Record: Regenerate API Clients After `excludeTags`

## Summary

This is a concrete SWE-smith-style task record derived from MoltNet git history.

- `fixture.ref`: `52d6e2dbd64570e966836a0f42595a49ea3c1b11`
- `gold_fix`: `5256794c992ad43fb890a08a90debdf190169978`
- `task_type`: `codegen-regeneration`

## Source History

- `52d6e2d` — `fix(search): apply excludeTags before ranking and pagination`
- `5256794` — `chore(api): regenerate clients after excludeTags updates`

The parent/fix boundary is useful because the source behavior changed first and
the generated artifacts were updated in a follow-up commit.

## Problem Statement

The `excludeTags` query parameter was added to the diary entry APIs, but the
generated client artifacts are stale. Regenerate the OpenAPI-derived clients so
the REST spec, TypeScript client, and Go client all expose `excludeTags`
correctly for `listDiaryEntries`.

## FAIL_TO_PASS

These checks should fail on `fixture.ref` and pass on `gold_fix`.

```bash
rg -n '"name": "excludeTags"' apps/rest-api/public/openapi.json
rg -n 'excludeTags\\?: string;' libs/api-client/src/generated/types.gen.ts
rg -n 'ExcludeTags OptString' cmd/moltnet-api-client/oas_parameters_gen.go
rg -n 'Encode "excludeTags" parameter' cmd/moltnet-api-client/oas_client_gen.go
rg -n 'Name: "excludeTags"' cmd/moltnet-api-client/oas_handlers_gen.go
```

## PASS_TO_PASS

These checks should already pass on the fixture and must remain passing after
the fix.

```bash
pnpm --filter @moltnet/rest-api run typecheck
pnpm --filter @moltnet/api-client run typecheck
pnpm run go:vet
```

## Gold Diff Signals

The gold fix adds the following generated outputs:

- OpenAPI query parameter in `apps/rest-api/public/openapi.json`
- `excludeTags?: string` in `libs/api-client/src/generated/types.gen.ts`
- `ExcludeTags OptString` and decode wiring in
  `cmd/moltnet-api-client/oas_parameters_gen.go`
- query encoding in `cmd/moltnet-api-client/oas_client_gen.go`
- parameter wiring in `cmd/moltnet-api-client/oas_handlers_gen.go`

## Why This Record Is Useful

This is a good dataset seed because:

- the fixture is a real historical repo state
- the task is grounded in an actual merged fix
- `FAIL_TO_PASS` is specific and deterministic
- `PASS_TO_PASS` preserves broader repository health
- the task crosses TypeScript and Go, which matches MoltNet's monorepo reality

## General Extraction Recipe

1. Pick a merged fix or follow-up regeneration commit.
2. Set `fixture.ref` to the parent or pre-regeneration commit.
3. Diff fixture against the fix commit.
4. Convert exact changed outputs into narrow `FAIL_TO_PASS` checks.
5. Keep broad health checks in `PASS_TO_PASS`.
6. Auto-verify:
   - fixture is red on `FAIL_TO_PASS`
   - fix is green on `FAIL_TO_PASS`
   - both are green on `PASS_TO_PASS`
