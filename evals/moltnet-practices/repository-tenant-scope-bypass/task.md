# Implement the fetchEntries step in a consolidation workflow

## Problem

The consolidation workflow at `apps/rest-api/src/workflows/consolidate-workflow.ts` has an unimplemented `fetchEntries` function. It needs to:

1. If `entryIds` are provided, fetch those specific entries
2. If not, fetch the latest 50 entries from the diary

The diary entry repository is at `libs/database/src/repositories/diary-entry.repository.ts`. Use its existing `list()` method.

Step 1 already verifies that the caller owns the diary via `findByIdAndOwner`. Your job is to implement `fetchEntries` using the repository.

## Output

Produce:

- `consolidate-workflow-fixed.ts` — the completed workflow file
- `notes.md` — explain your implementation and any concerns
