---
date: '2026-03-05T20:00:00Z'
author: claude-sonnet-4-6
session: feat/docker-build-speedup
type: handoff
importance: 0.5
tags: [ci, docker, build-performance, caching, dockerfile]
supersedes: null
signature: <pending>
---

# Docker Build Speed: Model Stage Isolation + .dockerignore Fixes

## Context

The `rest-api` Docker image build was the CI bottleneck (identified from run
#22730268692). The build was slow because the model download and onnxruntime
binary fetch ran in the `build` stage, after `COPY . .`, so every source
commit re-downloaded the e5-small-v2 ONNX model (~35MB from huggingface.co)
and rebuilt onnxruntime-node from scratch.

Additionally, `.worktrees/` and `.claude/` were not excluded from the Docker
build context despite containing full `node_modules` trees from all active
git worktrees.

## Substance

### Changes

**`apps/rest-api/Dockerfile`** — new `model` stage between `deps` and `build`:

```dockerfile
FROM deps AS model
COPY tools/download-embedding-model.mjs tools/
RUN pnpm --filter @moltnet/tools download-model -- --cache-dir /app/models
```

The `build` stage now gets the model via `COPY --from=model` instead of
running the download itself. Since both `model` and `build` branch off `deps`,
BuildKit runs them in parallel automatically.

Cache invalidation logic:

- `model` stage only rebuilds when `deps` changes (lockfile / package.json)
- `build` stage rebuilds on any source change (as before)
- Model download is decoupled from source changes

Only `tools/download-embedding-model.mjs` is copied into the model stage
(not `tools/src/`) to keep the cache key as narrow as possible.

**`.dockerignore`** — added:

```
.worktrees
.claude
```

These directories contain full `node_modules` copies from all active worktrees
and were being sent to the Docker daemon on every build.

### Verified

Local `docker build` confirmed the model and build stages run in parallel
(interleaved output in BuildKit log). Build context dropped to 13.97MB.
Image starts correctly; config validation rejects boot without required env
vars (expected production-hardened behavior).

## Continuity Notes

- Branch: `feat/docker-build-speedup` — PR opened targeting `main`
- The `pnpm rebuild onnxruntime-node --dir /app/deploy` step (build stage)
  is now redundant — `pnpm deploy` in build step #29 already runs the
  onnxruntime-node postinstall. Left in place as it's harmless; can be
  removed in a follow-up.
- Pre-baked model image (GHCR cache of e5-small-v2) was considered but
  deferred — the stage isolation achieves the same cache hit on normal
  source-only commits at zero operational overhead.
