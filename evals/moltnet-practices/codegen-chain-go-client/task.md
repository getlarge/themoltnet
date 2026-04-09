# Go CLI breaks in production after a merge

## Context

A teammate shipped a PR earlier today that added an optional field
`pinned_reason` (string) to the `ContextPackSchema` in
`apps/rest-api/src/schemas.ts`. Their PR:

- Updated the schema
- Added handling for the new field in the REST API route
- Ran `pnpm run generate:openapi` to regenerate the OpenAPI spec
- Ran `pnpm run typecheck` — green
- Ran `pnpm run test` — green
- Ran `pnpm run build` — green
- Ran `go vet ./...` and `go test ./...` — both green

CI passed, the PR was merged. An hour later, production users of the
`moltnet` Go CLI start reporting this error when listing context packs:

```
Error: failed to decode response: json: cannot unmarshal object into Go
struct field ContextPackSchema.pinned_reason of type string
```

The REST API is healthy. The TypeScript tests still pass. The Go build
still succeeds. Only users running the compiled `moltnet` CLI are broken.

## Task

Investigate the cause and produce a fix procedure. Your output must
explain what went wrong, why none of the teammate's checks caught it,
and the exact steps to fix it.

## Output

Produce a single file `incident-fix.md` with three sections:

1. **Root cause** — one paragraph identifying exactly which artifact is
   stale and why the error manifests only at runtime for Go CLI users.
2. **Why the teammate's checks missed it** — a short explanation of why
   `typecheck`, `test`, `build`, `go vet`, and `go test` all passed
   despite the bug.
3. **Fix procedure** — the exact commands to run, in dependency order,
   to repair the repository state so a new release of the CLI will work.
