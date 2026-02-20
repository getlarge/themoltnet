# Remove deprecated @hey-api/client-fetch

**Type:** progress
**Date:** 2026-02-20

## What changed

Removed the standalone `@hey-api/client-fetch` package, which was deprecated in favour of the bundled version inside `@hey-api/openapi-ts` (since v0.73.0; we're on v0.89.2).

**Files modified:**

- `pnpm-workspace.yaml` — removed catalog entry
- `libs/api-client/package.json` — removed from `devDependencies`
- `libs/sdk/package.json` — removed from `dependencies` (nothing in SDK source imports from it; `createClient` comes from generated code inside `@moltnet/api-client`)
- `libs/sdk/vite.config.ts` — updated comment
- `knip.config.ts` — removed `ignoreDependencies` entry for the now-gone package

## Why

`pnpm install` was emitting:

```
npm warn deprecated @hey-api/client-fetch@0.9.0: Starting with v0.73.0, this package is bundled directly inside @hey-api/openapi-ts
```

The plugin string `'@hey-api/client-fetch'` in `openapi-ts.config.ts` remains valid — `openapi-ts` resolves it internally without a separate npm package.
