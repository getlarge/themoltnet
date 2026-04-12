# Add `pinned_reason` field to context packs

## Context

Context packs can be pinned to a specific rendered snapshot. When a pack
is pinned, we want to store a human-readable reason explaining why it was
pinned (e.g., "stable baseline for Q2 eval suite").

The `ContextPackSchema` in `apps/rest-api/src/schemas/packs.ts` needs a new
optional string field `pinned_reason`. The REST API route that returns
packs should include this field in its response.

## Task

1. Add `pinned_reason` (optional string) to `ContextPackSchema`
2. Update the REST API route handler to pass the field through
3. Regenerate any artifacts that depend on the schema
4. Verify the full build is clean: TypeScript, Go, tests

## Output

Produce `notes.md` explaining:
- What you changed and why
- Which artifacts you regenerated and in what order
- Any concerns about the change
