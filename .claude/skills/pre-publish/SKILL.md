---
name: pre-publish
description: 'Validate a package before publishing to npm. Catches workspace dependency leaks, missing dist files, source leaks, and bundling issues. TRIGGER when: publishing to npm, modifying package.json dependencies of a publishable package, changing bundler config (vite.config, tsup.config), debugging npm install failures (E404, missing packages), or reviewing release-please PRs.'
---

# Pre-Publish Validation Skill

Mandatory checklist before publishing any package to npm. This skill exists
because workspace dependencies have leaked into published packages before,
breaking `npm install` for consumers.

## When to trigger

- Before running `pnpm publish` or `npm publish` on any package
- Before merging a PR that modifies `package.json` of a publishable package
- When adding or moving dependencies in a publishable package
- When modifying a package's Vite/bundler config
- Any time release-please creates a release PR

## Publishable packages

A package is publishable if it has a `files` field in `package.json` and is
not marked `"private": true`. Current published packages:

- `@themoltnet/sdk` (libs/sdk)
- `@themoltnet/design-system` (libs/design-system)
- `@themoltnet/cli` (packages/cli)
- `@themoltnet/github-agent` (packages/github-agent)
- `@themoltnet/legreffier` (packages/legreffier-cli)

## Checklist

### 1. Workspace dependency placement

Private workspace packages (`@moltnet/*`) must NEVER appear in `dependencies`
of a publishable package. They are not published to npm and will cause
`npm install` to fail.

**Rule**: If a `@moltnet/*` package is imported in source code and the build
bundles it (Vite SSR, esbuild, etc.), it belongs in `devDependencies`.

Check:

```bash
grep -n '@moltnet/' <package>/package.json
```

Expected: `@moltnet/*` entries appear only under `devDependencies`, never
under `dependencies`.

**Published workspace packages** (`@themoltnet/*`) with `workspace:*` are fine
in `dependencies` — pnpm rewrites `workspace:*` to concrete versions on
publish.

### 2. Build produces a valid bundle

For bundled packages (Vite SSR), verify the bundle doesn't contain runtime
imports to private workspace packages:

```bash
# Build the package and its workspace deps first
pnpm --filter <package> build

# Check the bundle has no @moltnet/ imports
grep '@moltnet/' <package>/dist/index.js
```

Expected: zero matches. All `@moltnet/*` code should be inlined.

### 3. Run check:pack

```bash
pnpm --filter <package> run check:pack
```

This validates:

- `dist/index.js` exists in the tarball
- `dist/index.d.ts` exists (for library packages)
- No `src/` files leak into the tarball
- No `@moltnet/` imports in `.d.ts` files
- No `@moltnet/` packages in `dependencies`

### 4. Verify the tarball contents

```bash
npm pack --dry-run --json 2>/dev/null | jq '.[0].files[].path'
```

Check that:

- Only expected files are included (typically `dist/` and `package.json`)
- No source files, test files, or config files leaked

### 5. Test install (optional but recommended for major releases)

```bash
npm pack
mkdir /tmp/test-install && cd /tmp/test-install
npm init -y
npm install <tarball-path>
node -e "import('<package-name>')"
```

## Common mistakes and how they happen

### Workspace deps in dependencies (the legreffier incident)

**What happened**: `@moltnet/api-client`, `@moltnet/crypto-service`, and
`@themoltnet/design-system` were listed in `dependencies` instead of
`devDependencies` in `@themoltnet/legreffier`. Vite correctly bundled them
into `dist/index.js`, but `pnpm publish` rewrote `workspace:*` to version
numbers and shipped a `package.json` that referenced unpublished packages.

**Why it wasn't caught**: The `check:pack` script only checked for
`@moltnet/` imports in `.d.ts` files and `src/` leaks in the tarball. It
didn't check the `dependencies` field itself.

**Prevention**: The `check:pack` script now validates that no `@moltnet/*`
packages appear in `dependencies`. Run it before every publish.

### SDK pattern (correct)

`@themoltnet/sdk` does it right:

- `@moltnet/api-client` and `@moltnet/crypto-service` in `devDependencies`
- `ssr.noExternal: [/@moltnet\//]` in `vite.config.ts` to explicitly bundle
- Only `@noble/*` (published) packages in `dependencies`

## Integration with CI

The `check:pack` step runs in the release workflow before `pnpm publish`.
If it fails, the publish is blocked. This is the last line of defense.

```yaml
# From .github/workflows/release.yml
- run: pnpm --filter <package> run check:pack
- run: pnpm --filter <package> publish --no-git-checks --access public --provenance
```

## Reminders

- Moving a dependency from `dependencies` to `devDependencies` requires
  updating the lockfile (`pnpm install`)
- Vite SSR mode bundles workspace-symlinked packages by default (no explicit
  `noExternal` needed), but explicit is better than implicit
- The `files` field in `package.json` controls what goes in the tarball —
  keep it minimal
