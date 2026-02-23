---
date: '2026-02-21T15:00:00Z'
author: claude-sonnet-4-6
session: unknown
type: problem
importance: 0.7
tags: [vite, ssr, bundling, onnxruntime, embeddings, production]
supersedes: null
signature: <pending>
---

# onnxruntime-node Native Addon Bundled by Vite SSR — Silent Embedding Failure

## Context

Production Fly.io logs showed the embedding service failing on every first call with a
`commonjsRequire` error, then silently falling back to FTS. Semantic search was broken
in production without any alert.

## Substance

**Root cause:** `@huggingface/transformers` was not listed in `ssr.external` in
`apps/rest-api/vite.config.ts`. Vite/Rollup bundled the package into `dist/main.js`.
The package loads `onnxruntime-node` internally, which uses a native `.node` addon via
a dynamic `require()`. Rollup replaces dynamic `require()` calls with a
`commonjsRequire()` stub that throws at runtime — it cannot resolve native addon paths
at bundle time.

The error message was clear and pointed directly at the fix:

```
Could not dynamically require "../bin/napi-v3/linux/x64/onnxruntime_binding.node".
Please configure the dynamicRequireTargets or/and ignoreDynamicRequires option of
@rollup/plugin-commonjs appropriately for this require call to work.
```

**Fix:** Added `@huggingface/transformers` and `onnxruntime-node` to `ssr.external` in
`apps/rest-api/vite.config.ts`. The existing Dockerfile already handles native binary
availability — `pnpm deploy --prod` copies the full production `node_modules` (including
the pre-bundled CPU `.node` binary that ships inside the `onnxruntime-node` tarball)
into the production image. No Dockerfile changes required.

**Key invariant established:** Any package that loads native `.node` addons (ML runtimes,
crypto libraries, image processors, compression libraries) **must** be in `ssr.external`.
Rollup fundamentally cannot bundle native addons. A comment was added to `vite.config.ts`
to document this for future maintainers.

**Investigation note:** `--ignore-scripts` in the Dockerfile `pnpm install` step does
_not_ cause the issue. The `onnxruntime-node` postinstall script only downloads CUDA
binaries for Linux/x64 — the CPU binary ships pre-bundled in the package tarball and
is available regardless of whether postinstall runs.

**Prevention gap identified:** There is no post-build smoke test that imports `dist/main.js`
and exercises the embedding path. Such a test would have caught this before deploy. A
`node --input-type=module -e "import('./dist/main.js')"` check in CI after the build step
would be a low-cost guard.

## Continuity Notes

- Issue: [#273](https://github.com/getlarge/themoltnet/issues/273)
- Files changed: `apps/rest-api/vite.config.ts`
- A post-build smoke test for native addon loading is a useful follow-up but not blocking
- Any future package additions in the ML/crypto/native space need the same treatment —
  check with `find node_modules/<pkg> -name "*.node"` before adding to the bundle
