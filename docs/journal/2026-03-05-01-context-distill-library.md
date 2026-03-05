---
date: '2026-03-05T18:00:00Z'
author: claude-sonnet-4-6
session: feat/context-distill-358
type: handoff
importance: 0.8
tags: [context-distill, clustering, mmr, compression, phase1, algorithms]
supersedes: null
signature: <pending>
---

# Phase 1: @moltnet/context-distill Library

## Context

Issue #358 — implement a pure TypeScript algorithm library for deterministic scan consolidation, the first phase of the Context Flywheel. The library takes diary entries (already embedded) and produces a context pack within a token budget, suitable for injecting into agent context windows.

Three phases were planned and split into subissues:

- Phase 1 (this): pure algorithm library — `libs/context-distill/`
- Phase 2 (#361): REST API + DBOS workflows
- Phase 3 (#362): MCP tools

## Substance

### What was built

`@moltnet/context-distill` — a private library at `libs/context-distill/` with six pure functions and no IO:

**`cluster(entries, options)`** — agglomerative clustering with average linkage and cosine distance. O(n²), suitable for ≤500 entries. `threshold=0` special-cased to return singletons (avoids merging on exact-zero distance). Embedding dimension inferred from `embedding.length` — not hardcoded to 384.

**`select(members, strategy)`** — picks a representative from a cluster. Three strategies: `score` (highest importance), `centroid` (closest to geometric centroid), `hybrid` (weighted average of both). Returns `suggestedAction`: `merge` (similarity ≥ 0.9), `review` (≥ 0.7), `keep_separate` otherwise.

**`mmr(entries, queryEmbedding, options)`** — Maximal Marginal Relevance re-ranking. `λ * relevance - (1-λ) * maxSim`. Falls back to `importance/10` when no query embedding. Pure greedy loop, no hardcoded dimensions.

**`compress(entry, level)`** — extractive compression without mutating entries. Three levels: `full` (identity), `summary` (top 30% sentences by position+length score, returned in original order), `keywords` (words ≥4 chars + CamelCase + digits, deduplicated, capped at 30 tokens).

**`consolidate(entries, options)`** — cluster→select orchestrator. Returns `ConsolidateResult` with clusters, stats (inputCount, clusterCount, singletonRate, clusterSizeDistribution as percentiles, elapsedMs), and trace (thresholdUsed, strategyUsed, embeddingDim).

**`compile(entries, options)`** — MMR→enforceBudget orchestrator. Also exports `enforceBudget(ranked, tokenBudget)` as a standalone function for the Phase 2 "LLM sandwich" pattern: compile ranks entries, an optional LLM reviewer reorders them, then `enforceBudget` re-applies the hard token constraint before returning to the caller.

### Key design decisions

- **No SDK exposure** — library is private, not published. Phase 2 will expose via REST API.
- **`wRecency` not `decay_config`** — recency weighting is a DB query parameter, not computed here.
- **`enforceBudget` exported separately** — enables the Phase 2 pattern: `compile` (MMR order) → LLM review step → `enforceBudget` (deterministic budget cut). The guardrail is always the last step.
- **Entries never mutated** — compress returns a `CompiledEntry` with compressed content; the original `DistillEntry` is untouched.
- **CamelCase regex fix** — keyword extraction uses `/[a-z][A-Z]/` (lower→upper transition) not `/[A-Z][a-z]/` which was incorrectly matching sentence-starting words.
- **vitest.config.ts required per package** — without it, IDEs show false "Cannot find module" errors in test files even though `vitest run` works. Pattern confirmed from `libs/crypto-service/`.
- **Bench files excluded from `include` in vitest.config** — `bench()` is only available in `vitest bench` mode; including bench files in `vitest run` causes runtime errors.

### Test coverage

131 tests across 6 files. Highlights:

- `cosineDistance` unit tests (identical=0, orthogonal=1, opposite=2, zero vector=1, symmetry)
- Cluster membership verified by ID, not just count
- Centroid strategy tested geometrically (mid entry at [0.9,0.44,0] is provably closest to centroid of [1,0,0]+[0,1,0]+[0.9,0.44,0])
- MMR lambda=1 verifies full ordering by query similarity; lambda=0 verifies diversity selection
- Budget invariant tested across sizes [50, 200, 1000, 8000]
- `enforceBudget([], budget=0)` returns empty with `budgetUtilization=0`
- Keywords-only fit: entry too big for full/summary still included at keywords level
- `compressionRatio=1` when no compression occurs
- Output sentences are strict subset of input sentences (exact `.toContain()` check)
- `ceil(10 * 0.3) = 3` sentences kept from 10-sentence input

## Continuity Notes

- Branch: `feat/context-distill-358` — PR to be created now
- Phase 2 (#361): DBOS workflow that fetches entries from DB (using existing `diary_search()` with `wRecency`), calls `consolidate` then `compile`, stores result. `enforceBudget` export is the integration point.
- Phase 3 (#362): MCP tool wrapping Phase 2 workflow
- The `compile` function's `taskPromptEmbedding` is a pre-computed embedding — Phase 2 must embed the current task prompt before calling `compile`
- Benchmark results: 500-entry cluster ~53ms, 100-entry compile ~48ms — well within acceptable latency
- `estimateTokens` uses GPT-family ~0.75 words/token approximation; accurate enough for budget enforcement
