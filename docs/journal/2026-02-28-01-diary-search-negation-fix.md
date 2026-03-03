---
date: '2026-02-28T07:00:00Z'
author: claude-opus-4-6
session: session_01LNt1jT8vg7uahNqdiUQbu5
type: handoff
importance: 0.8
tags: [handoff, search, negation, diary-search, embedding]
supersedes: null
signature: <pending>
---

# Handoff: Diary Search Negation Fix & E5-base-v2 Analysis

## What Was Done This Session

- **Fixed #295: negation not working in diary search**
  - Root cause: `diary_search()` SQL function uses RRF (Reciprocal Rank Fusion) via FULL OUTER JOIN to combine vector similarity and FTS results. FTS correctly handles negation via `websearch_to_tsquery` (e.g., `'deploy' & !'stage'`), but vector search has no concept of negation — entries excluded by FTS still surface through the vector CTE.
  - Fix: migration `0016_negation_post_filter.sql` rewrites `diary_search()` to pre-compute the tsquery in a DECLARE block, detect negation (`!` operator in tsquery text), and apply the tsquery as a post-filter on the final SELECT. When no negation is present, behavior is identical to before.
  - Trade-off accepted: for negation queries, pure-vector results (semantically relevant but missing positive keywords) are also excluded. This is acceptable because negation is a keyword-level assertion — the user is being specific.

- **Unskipped and strengthened e2e negation tests**
  - Unskipped the existing `it.skip('negation with minus excludes matching entries')` test
  - Strengthened assertions: checks `production release` content appears, `staging` tag is absent (hard exclude, not just rank-based)
  - Added second test: `deploy -production` verifying the symmetric case (staging appears, production excluded)

- **Provided e5-base-v2 upgrade analysis** (research only, no code changes)
  - Detailed what would change: 384→768 dimension across ~20 files, model size 5-7x, re-embedding all data
  - Conclusion: not worth it at current scale. The negation issue was a search logic bug, not an embedding quality problem.

## Current State

- **Branch**: `claude/typesense-diary-research-IGw6n`
- **Commit**: `586b62e` — `fix(database): enforce negation predicates in diary_search() (#295)`
- **Tests**: lint clean (0 errors), unit tests pass (integration tests skip due to no Docker in sandbox)
- **E2E tests**: cannot run in sandbox (requires Docker Compose stack), but the SQL fix is straightforward and the test logic is correct
- **Build**: not verified (no Docker), but no TypeScript changes — only SQL migration + test file

## Decisions Made

1. **Post-filter on final SELECT vs filtering in vector_cte**: Chose final SELECT because it's more robust — catches any negated entry regardless of which CTE surfaced it. The WHERE clause `NOT v_has_negation OR diary_entry_tsv(...) @@ v_tsquery` is a no-op for non-negation queries.

2. **Pre-computed tsquery variable**: Moved from LATERAL `websearch_to_tsquery()` in fts_cte to a DECLARE'd `v_tsquery` variable. This avoids recomputing the tsquery multiple times and makes the negation detection clean.

3. **Full tsquery enforcement (not negation-only extraction)**: Considered parsing the tsquery to extract only negated terms, but this is fragile in SQL. Instead, we apply the full tsquery as a filter when negation is detected. The trade-off (requiring positive keyword match for vector results) is acceptable for negation queries.

## What's Not Done Yet

- **E2E validation**: The negation tests need to run against a real Docker Compose stack to confirm the SQL fix works end-to-end. The migration and test are committed but untested in integration.
- **Issue #295**: Should be closable once E2E tests pass. The PR needs review.

## Where to Start Next

1. Read this handoff
2. Start the E2E stack: `docker compose -f docker-compose.e2e.yaml up -d --build`
3. Run `pnpm --filter @moltnet/rest-api run test:e2e` — verify the two negation tests pass
4. If tests pass, close #295 and merge the PR
5. If the full-tsquery enforcement is too aggressive (kills valid vector results in practice), consider the alternative: extract only negated terms from the tsquery and apply a narrower filter
