# Context Distill Design

**Issue**: #358
**Date**: 2026-03-05
**Status**: Approved

## Problem

The scan consolidation pipeline produces raw `source:scan` diary entries with 30-40% semantic overlap across sessions. Consolidation currently relies on LLM-driven summarization: slow, non-deterministic, expensive. No dedup, no token-budget compression, no cache invalidation on code changes.

## Solution

A new `libs/context-distill/` library of four deterministic algorithms (zero LLM calls), run as DBOS workflows in the REST API, exposed as MCP tools. Replaces LLM-heavy consolidation mechanics with fast, reproducible computation — agent-level review and policy decisions stay in the skill layer.

## Direction Update (2026-03-05)

Context-distill is now treated as the deterministic backend for a "context
compiler" flow (similar to the REPL-brain idea), not as a standalone
consolidation endpoint.

Key clarifications:

- **Scan entries stay mandatory**: we still need scan/consolidation outputs as
  long-lived memory artifacts.
- **Compile must be task-aware**: `context_compile` should prioritize by task
  signal (`task_prompt` or query embedding), not only by global ranking.
- **DBOS orchestrates mixed compute**:
  1. deterministic fetch/rank/compress activities
  2. optional bounded LLM review activity
  3. deterministic policy/budget validation
- **LLM is reviewer, not source of truth**:
  - may reorder keep/drop candidates
  - may flag missing risk/caveat
  - cannot invent ungrounded rules
- **Deterministic guardrails remain final**:
  - hard token budget
  - required boundary rules (security/workflow/write-path)
  - provenance enforcement (all kept items map to source entry IDs)

This keeps output reproducible while allowing targeted judgment where
deterministic heuristics are weakest.

## Phasing

- **Phase 1** (subissue A): `libs/context-distill/` — pure algorithms, full test + benchmark suite
- **Phase 2** (subissue B): REST API — DBOS workflows, endpoints, dedup queue, api-client regen
- **Phase 3** (subissue C): MCP server — two tools, skill updates

## Library Structure

```
libs/context-distill/
  src/
    cluster.ts      # Agglomerative clustering (cosine distance, average linkage)
    selector.ts     # Representative selection (score/centroid/hybrid)
    mmr.ts          # Maximal Marginal Relevance re-ranking
    compress.ts     # Extractive sentence compression (embedding coherence scoring)
    consolidate.ts  # Orchestrator: cluster → select
    compile.ts      # Orchestrator: MMR → compress → budget-fit
    types.ts        # Shared input/output types
    index.ts
  __tests__/
    cluster.test.ts
    selector.test.ts
    mmr.test.ts
    compress.test.ts
    consolidate.test.ts
    compile.test.ts
    benchmarks/
```

### Key design decisions

**Pure functions throughout** — no DB handles, no IO. All algorithms operate on plain arrays of `{ id, embedding, content, tokens, importance, createdAt }`. Testable in isolation, usable without any infrastructure.

**Two orchestrators, not one**:

- `consolidate.ts`: cluster → select. Returns cluster groups with representatives for agent review. The agent decides what to write/supersede — nothing is auto-written.
- `compile.ts`: MMR → compress → budget-fit. Returns a fitted context pack for injection. Entries are never mutated.

**Compression tiers** (read-time only, entries never mutated in storage):

- `full` — include as-is
- `summary` — top-k sentences ranked by cosine similarity to the entry's own embedding centroid (semantic, not heuristic)
- `keywords` — last resort before exclusion: extract identifiers and noun phrases from content at read time

**No `decay_config`** — the issue's `summary_age`/`keywords_age` thresholds are replaced by `wRecency` passed to the DB query that pre-fetches entries for compile. This reuses the existing `diary_search()` weighted scoring (relevance + recency + importance) instead of introducing a separate decay model. Simpler and consistent with the existing search API.

**Entry count cap for clustering** — agglomerative clustering requires O(n²) distance matrix, so consolidation calls should be scoped by tags/session. Document a soft cap of 500 entries; beyond that, callers must filter.

## REST API Workflows

### `consolidateWorkflow`

```
Idempotency key: {diary_id, entry_ids_hash}
Dedup queue key: identity_id (one active consolidation per agent, queued not dropped)

Step 1: fetch entries + embeddings from pgvector (direct DB query, filtered by tags/entry_ids)
Step 2: cluster() + select() from context-distill
Step 3: return clusters + suggested_actions + stats
```

Triggered on demand via `POST /diaries/:id/consolidate`. DBOS idempotency means the same input hash returns the cached result without re-running the O(n²) computation.

### `compileWorkflow`

```
Idempotency key: {diary_id, latest_entry_id, task_prompt_hash, token_budget}

Step 1: fetch semantic entries from pgvector with wRecency + wImportance weights
Step 2: MMR re-rank anchored to task_prompt embedding (or global if no prompt)
Step 3: compress to fit token_budget (full → summary → keywords → exclude)
Step 4: optional LLM review of candidate pack (bounded, no new facts)
Step 5: deterministic final policy + budget enforcement
```

Triggered on demand via `POST /diaries/:id/compile`.

### Future hook for agent delegation (#262)

The consolidate workflow response includes `workflow_id`. A future endpoint `POST /diaries/:id/consolidate/:workflowId/delegate` can hand off cluster results to an agent via MCP client, receive agent decisions, then run a final step to write semantic entries and supersede sources. The workflow is structured with this third step slot in mind — clustering (steps 1-2) is already separate from writing (not done server-side today, but the slot exists). This works around the missing MCP sampling capability.

### Endpoints

- `POST /diaries/:id/consolidate` — trigger or return cached consolidation result
- `POST /diaries/:id/compile` — trigger or return cached context pack

## MCP Tools

### `context_consolidate`

```
Input: {
  diary_id,
  entry_ids?,       // specific entries to consolidate
  tags?,            // e.g. ["source:scan", "scan-session:X"]
  threshold?,       // cosine distance, default 0.15
  strategy?         // "score" | "centroid" | "hybrid", default "hybrid"
}

Output: {
  workflow_id,      // for future delegation
  clusters: [{
    representative,
    representative_reason,
    members,
    similarity,
    confidence,
    suggested_action  // "merge" | "keep_separate" | "review"
  }],
  stats: { input_count, cluster_count, singleton_rate, cluster_size_distribution, elapsed_ms },
  trace: { threshold_used, strategy_used, embedding_model, embedding_dim }
}
```

### `context_compile`

```
Input: {
  diary_id,
  task_prompt?,     // MMR relevance anchor; global ranking if omitted
  token_budget,
  lambda?,          // MMR relevance vs diversity, default 0.5
  include_tags?,
  exclude_tags?,
  w_recency?,       // passed to DB query for pre-fetch ranking, default 0.0
  w_importance?     // passed to DB query for pre-fetch ranking, default 0.0
}

Output: {
  entries: [{
    id, content,              // content is the compressed representation
    compression_level,        // "full" | "summary" | "keywords"
    original_tokens,
    compressed_tokens
  }],
  stats: { total_tokens, entries_included, entries_compressed, compression_ratio, budget_utilization, elapsed_ms },
  trace: { lambda_used, embedding_model, embedding_dim, task_prompt_hash? }
}
```

## What Is Explicitly Out of Scope

- SDK re-exports of context-distill algorithms (dropped — MCP tools are the interface)
- DBOS `writeStream`/`readStream` for entry streaming (deferred — fetch on demand for now)
- Server-side auto-writing of consolidated entries (agent always decides what gets written)
- Decay as a stored snapshot or write-time mutation (replaced by `wRecency` at query time)

## References

- #338 — legreffier-scan skill (produces the entries this feature consolidates)
- #262 — memory consolidation skill (agent-side protocol, future delegation hook)
- `libs/database/src/repositories/diary-entry.repository.ts` — existing `wRecency`/`wImportance` weighted search
- `apps/rest-api/src/workflows/` — existing DBOS workflow patterns
- `apps/mcp-server/src/diary-tools.ts` — existing MCP tool pattern
