---
date: '2026-02-01T15:00:00Z'
author: claude-opus-4-5-20251101
session: unknown
type: handoff
importance: 0.7
tags: [handoff, ws3, embedding-service, diary-service, transformers, e5]
supersedes: null
signature: pending
---

# Handoff: @moltnet/embedding-service Package & Diary Integration

## What Was Done This Session

- Created `libs/embedding-service/` workspace package
- Implemented `createEmbeddingService()` factory using `@huggingface/transformers` with `intfloat/e5-small-v2`
- Added `@huggingface/transformers` to pnpm catalog, `onnxruntime-node` to `onlyBuiltDependencies`
- Fixed pipeline loading failure recovery: rejected promises are now cleared so transient errors don't permanently break the service
- 12 unit tests passing (all with mocked transformers — no model download in CI)
- Wired `@moltnet/embedding-service` into diary-service integration tests: when `EMBEDDING_MODEL=true` is set, tests exercise real vector embeddings and hybrid search end-to-end
- Rebased onto main after diary-service PR (#46) merged
- Full validation suite passing: lint, typecheck, build, all workspace tests

## What's Not Done Yet

- MCP server and REST API composition roots still use `createNoopEmbeddingService()` — wiring in the real service requires deciding on model caching strategy for production
- `cacheDir` default not set — consumers must provide it or rely on HuggingFace defaults
- No model pre-download in Docker build

## Current State

- Branch: `claude/embedding-service`
- PR: #45
- Tests: 12 passing in embedding-service, all workspace tests passing
- Build: clean
- Lint: clean (0 new warnings)
- Typecheck: clean

## Decisions Made

- **Factory pattern over class**: `createEmbeddingService(options?)` returns `{ embedPassage, embedQuery }` — structurally compatible with diary-service's `EmbeddingService` interface without explicit import
- **Lazy singleton for pipeline**: Model loaded on first embed call, cached in module-level promise. Avoids loading at import time. Promise cleared on failure so next call retries
- **L2 normalization applied in embedding-service**: Vectors are unit-length before reaching the database, matching pgvector's `vector_cosine_ops` index
- **Zero vector safety**: Returns zero vector (not NaN) when input produces all-zero embeddings
- **Quantization default is q8**: Good balance of speed and accuracy for e5-small-v2
- **`resetPipeline()` exported for testing**: Allows tests to clear the lazy singleton between runs
- **Opt-in embedding in integration tests**: `EMBEDDING_MODEL=true` env var gates real embedding usage so CI without the model still passes; tests that depend on embeddings use early return when the flag is absent

## Open Questions

- Should the model be pre-downloaded during Docker build? Currently relies on runtime download on first call
- Should there be a `warmup()` function that pre-loads the model without embedding text?

## Where to Start Next

1. Wire `createEmbeddingService()` into the MCP server and REST API composition roots, replacing `createNoopEmbeddingService()`
2. Consider adding a `warmup()` method or option to pre-load the model at server startup
3. Set up model caching in Docker builds to avoid runtime downloads in production
4. Run integration tests with `EMBEDDING_MODEL=true` against a real Postgres+pgvector instance to validate hybrid search end-to-end
