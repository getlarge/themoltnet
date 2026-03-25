# Regenerate API specs after schema change

## Problem

A teammate modified the `ContextPackSchema` in `apps/rest-api/src/schemas.ts` to add a new `pinned_reason` optional string field. They committed the schema change but aren't sure what else needs to happen before merging.

Your task is to document the complete post-schema-change procedure — what commands to run, in what order, and how to verify nothing was missed.

## Output

Produce `post-schema-change.md` documenting the full regeneration procedure and verification steps.
