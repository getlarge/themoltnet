---
date: '2026-02-01T15:00:00Z'
author: claude-opus-4-5-20251101
session: unknown
type: handoff
importance: 0.7
tags: [handoff, ws3, embedding-service, transformers, e5]
supersedes: null
signature: pending
---

# Handoff: @moltnet/embedding-service Package

## What Was Done This Session

- Created `libs/embedding-service/` workspace package
- Implemented `createEmbeddingService()` factory using `@huggingface/transformers` with `intfloat/e5-small-v2`
- Added `@huggingface/transformers` to pnpm catalog, `onnxruntime-node` to `onlyBuiltDependencies`
- 11 unit tests passing (all with mocked transformers — no model download in CI)
- Full validation suite passing: lint, typecheck, build, all 343 workspace tests

## What's Not Done Yet

- Integration with diary-service (diary-service already has the `EmbeddingService` interface and a no-op implementation; swapping to real service is a one-line change at the composition root)
- No integration test with actual model download (would require ~130MB download)
- `cacheDir` default not set — consumers must provide it or rely on HuggingFace defaults

## Current State

- Branch: `claude/embedding-service`
- Tests: 11 passing in embedding-service, 343 passing across workspace
- Build: clean
- Lint: clean (0 new warnings)
- Typecheck: clean

## Decisions Made

- **Factory pattern over class**: `createEmbeddingService(options?)` returns `{ embedPassage, embedQuery }` — structurally compatible with diary-service's interface without explicit import
- **Lazy singleton for pipeline**: Model loaded on first embed call, cached in module-level promise. Avoids loading at import time
- **L2 normalization applied in embedding-service**: Vectors are unit-length before reaching the database, matching pgvector's `vector_cosine_ops` index
- **Zero vector safety**: Returns zero vector (not NaN) when input produces all-zero embeddings
- **Quantization default is q8**: Good balance of speed and accuracy for e5-small-v2
- **`resetPipeline()` exported for testing**: Allows tests to clear the lazy singleton between runs

## Open Questions

- Should the model be pre-downloaded during `pnpm install` or Docker build? Currently relies on runtime download on first call
- Should there be a warmup function that pre-loads the model without embedding text?

## Where to Start Next

1. Wire `createEmbeddingService()` into the MCP server and REST API composition roots, replacing `createNoopEmbeddingService()`
2. Consider adding a `warmup()` method or option to pre-load the model at server startup
3. Set up model caching in Docker builds to avoid runtime downloads in production
