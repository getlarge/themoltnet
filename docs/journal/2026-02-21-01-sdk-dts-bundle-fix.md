# SDK .d.ts Declaration Bundling Fix

**Type:** progress
**Date:** 2026-02-21
**Issue:** [#257](https://github.com/getlarge/themoltnet/issues/257)

## What changed

Fixed `@themoltnet/sdk` published package — `.d.ts` declaration files no longer
reference `@moltnet/api-client` or `@moltnet/crypto-service` (private workspace
packages not on npm), which caused TypeScript errors for SDK consumers.

**Files modified:**

- `pnpm-workspace.yaml` — added `vite-plugin-dts: ^4.5.4` to catalog
- `libs/sdk/package.json` — added `vite-plugin-dts` to devDeps, simplified build
  script to `vite build` only, added `check:types-isolation` script
- `libs/sdk/vite.config.ts` — added `dts({ rollupTypes: true, compilerOptions: { paths } })`
  plugin; removed `bundledPackages` (caused class body inlining); added `paths`
  override to resolve workspace packages via their compiled `dist/*.d.ts` rather
  than their `src/index.ts` source
- `scripts/check-pack.ts` — added scan of `.d.ts` file contents for `@moltnet/`
  workspace import leaks
- `scripts/check-sdk-types-isolation.ts` — new script: compiles a minimal
  consumer against `libs/sdk/dist/` in a temp dir with no workspace packages,
  simulating what npm consumers experience
- `.github/workflows/release.yml` — added `check:types-isolation` step in
  `publish-sdk` job before `npm publish`

## Root cause

`tsc -b --emitDeclarationOnly` preserves original import paths verbatim.
Vite's `noExternal: [/@moltnet\//]` only affects JS bundling — it has no
equivalent for TypeScript declaration emit. The `check-pack.ts` script only
verified file presence, not `.d.ts` content.

## Key discovery

`bundledPackages: ['@moltnet/api-client', '@moltnet/crypto-service']` in
`vite-plugin-dts` initially appeared to fix the leaks but introduced a new
bug: the plugin resolved workspace packages via their `exports["types"]` field
(`src/index.ts`), inlining full class implementations (method bodies) into the
`.d.ts` output, making it invalid TypeScript (`TS1039`, `TS1183` errors).

The correct fix is `compilerOptions.paths` overrides pointing at the pre-built
`dist/*.d.ts` files. This way `rollupTypes` inlines proper declaration-only
content from the compiled output, not source implementations.

## Verification

```bash
pnpm --filter @themoltnet/sdk build
grep "@moltnet/" libs/sdk/dist/index.d.ts  # no output
pnpm --filter @themoltnet/sdk check:pack   # OK (3 files)
pnpm --filter @themoltnet/sdk check:types-isolation  # ✓
pnpm --filter @themoltnet/sdk test         # 97/97 pass
```
