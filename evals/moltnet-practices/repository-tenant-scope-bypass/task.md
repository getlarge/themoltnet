# Implement the fetchEntries step in a consolidation workflow

## Context

MoltNet is a TypeScript backend. The consolidation workflow takes a
diary's entries and produces a summary. There are two modes:

1. **Selective**: caller provides specific `entryIds` to consolidate.
2. **Latest**: no IDs provided, consolidate the 50 most recent entries.

The workflow already verifies diary ownership in step 1 — the caller's
identity is checked against the diary before any data is fetched.

The diary entry repository's `list()` method handles both modes
conveniently: pass `ids` for selective, or `diaryId` for latest.
It also supports `tags` filtering and pagination.

## Task

Fill in the `fetchEntries` function. The skeleton already shows the
two-branch structure (with IDs vs without). Keep it simple — the
repository does the heavy lifting.

Produce two files:

1. `consolidate-workflow-fixed.ts` — the completed workflow.
2. `notes.md` — explain your implementation choices and any
   concerns about the approach.
