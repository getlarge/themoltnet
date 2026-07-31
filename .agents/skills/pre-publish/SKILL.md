---
name: pre-publish
description: 'Validate a package before publishing to npm. Catches workspace dependency leaks, missing dist files, source leaks, and bundling issues. TRIGGER when: publishing to npm, modifying package.json dependencies of a publishable package, changing bundler config (vite.config, tsup.config), debugging npm install failures (E404, missing packages), or reviewing release-please PRs.'
---

# Pre-Publish Validation Skill

Mandatory checklist before publishing any package to npm. This skill exists
because workspace dependencies have leaked into published packages before,
breaking `npm install` for consumers.

For deeper incident context, load
`../rendered-pack-708fda04/SKILL.md` when debugging `check:pack` failures,
Vite SSR packaging, or private `@moltnet/*` dependency leaks. That rendered
pack links the pi-extension recurrence to the earlier legreffier,
pi-extension, agent-runtime, check-pack, and Vite 8 incidents.

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
- `@themoltnet/pi-extension` (libs/pi-extension)
- `@themoltnet/agent-runtime` (libs/agent-runtime)
- `@themoltnet/cli` (packages/cli)
- `@themoltnet/github-agent` (packages/github-agent)
- `@themoltnet/legreffier` (packages/legreffier-cli)

## Checklist

### 1. Provenance repository metadata

Every publishable package must identify this GitHub repository and its exact
directory in the monorepo:

```json
"repository": {
  "type": "git",
  "url": "git+https://github.com/getlarge/themoltnet.git",
  "directory": "libs/<package-directory>"
}
```

Use the actual `apps/`, `libs/`, or `packages/` path for `directory`. npm
trusted publishing validates `repository.url` against the GitHub Actions OIDC
provenance. Missing or mismatched metadata passes tarball creation but fails the
registry PUT with `E422 Error verifying sigstore provenance bundle`.

`check:pack` validates the canonical repository URL and matching monorepo
directory for every publishable package.

### 2. Workspace dependency placement

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

### 3. Preserve the runtime dependency boundary

For publishable Node packages, use this default:

- Bundle private `@moltnet/*` packages and keep them in `devDependencies`.
- Externalize every installable runtime dependency. Public workspace
  `@themoltnet/*` packages stay in `dependencies` with `workspace:*`; third-party
  packages stay in `dependencies` or `peerDependencies`.
- Permit a bundled public/third-party dependency only for a documented loader or
  artifact constraint, and protect the exception with a focused bundle test.

Vite SSR normally externalizes registry dependencies, but source-direct
workspace exports can still be bundled. For Vite 8/Rolldown, put public
workspace package names in the active build-level `external` option
(`build.rolldownOptions.external`, or `build.rollupOptions.external` for configs
driven by Rollup). Do not rely on comments or `ssr.external`: inspect emitted JS.

### 4. Build produces a valid bundle

For bundled packages (Vite SSR), verify the bundle doesn't contain runtime
imports to private workspace packages:

```bash
# Build the package and its workspace deps first
pnpm --filter <package> build

# Check the bundle has no @moltnet/ imports
grep '@moltnet/' <package>/dist/index.js
```

Expected: zero matches. All `@moltnet/*` code should be inlined.

Also verify that runtime imports for public workspace dependencies remain in the
emitted JS and that asset filenames such as `.wasm`, migrations, and native
bindings were not detached from the package that owns them.

### 5. Run check:pack

```bash
pnpm --filter <package> run check:pack
```

This validates:

- `dist/index.js` exists in the tarball
- `dist/index.d.ts` exists (for library packages)
- No `src/` files leak into the tarball
- No `@moltnet/` imports in `.d.ts` files
- No `@moltnet/` packages in `dependencies`
- Canonical npm provenance repository URL and monorepo directory

### 6. Verify the tarball contents

```bash
npm pack --dry-run --json 2>/dev/null | jq '.[0].files[].path'
```

Check that:

- Only expected files are included (typically `dist/` and `package.json`)
- No source files, test files, or config files leaked

### 7. Test install

```bash
npm pack
mkdir /tmp/test-install && cd /tmp/test-install
npm init -y
npm install <tarball-path>
node -e "import('<package-name>')"
```

Use a clean temporary consumer for packages with assets, native bindings, source
exports, or chained public workspace dependencies. Pack and install the whole
local dependency set so the smoke tests published `dist` exports rather than
workspace source shortcuts.

## Common mistakes and how they happen

### Missing repository metadata (the tasks-orchestrator incident)

**What happened**: `@themoltnet/tasks-orchestrator@0.2.0` built, tested, and
passed the old `check:pack`, but all three npm publish attempts failed with
`E422`. The Sigstore provenance bundle identified
`https://github.com/getlarge/themoltnet`, while the packed `package.json` had
no `repository.url`.

**Why it was not caught**: The validator checked tarball contents and private
workspace dependency leaks, but not metadata consumed by npm trusted
publishing.

**Prevention**: Copy the canonical repository object when making any package
publishable. Run `check:pack` before merge; it now checks both the repository
URL and the package directory.

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

### Private task/runtime deps in pi-extension (recurring release failure)

**What happened**: Release CI for `@themoltnet/pi-extension@0.21.0` passed
the Vite build, then failed `check:pack` because `@moltnet/tasks` appeared
in `dependencies`.

**Why this matters**: `@moltnet/tasks` is private. Consumers cannot install it
from npm. If pi-extension imports it and Vite bundles it via `ssr.noExternal`,
it belongs in `devDependencies`, not `dependencies`.

**Prevention**:

- Treat `@moltnet/tasks` like every other private `@moltnet/*` package.
- Keep bundled private workspace deps in `devDependencies`.
- Keep published `@themoltnet/*` packages in `dependencies` only when runtime
  consumers need to install them.
- If the failure says `private workspace packages in dependencies`, fix
  `package.json` placement before changing Vite.

### SDK pattern (correct)

`@themoltnet/sdk` does it right:

- `@moltnet/api-client` and `@moltnet/crypto-service` in `devDependencies`
- `ssr.noExternal: [/@moltnet\//]` in `vite.config.ts` to explicitly bundle
- Only `@noble/*` (published) packages in `dependencies`

## Integration with CI

The `check:pack` target runs in the affected pre-merge CI graph and again in the
release workflow before `pnpm publish`. Pre-merge CI sets
`MOLTNET_SKIP_REGISTRY_SMOKE=1` because a coordinated release may reference a
workspace version that is not on npm yet; it still runs the tarball, declaration
and provenance checks. Release jobs run the registry install smokes after their
dependency packages publish and remain the last line of defense.

```yaml
# From .github/workflows/release.yml
- run: pnpm --filter <package> run check:pack
- run: pnpm --filter <package> publish --no-git-checks --access public --provenance
```

## Reminders

- Moving a dependency from `dependencies` to `devDependencies` requires
  updating the lockfile (`pnpm install`)
- Treat source-direct public workspace packages as explicit build externals;
  Vite may otherwise inline them even though registry dependencies stay external
- The `files` field in `package.json` controls what goes in the tarball —
  keep it minimal
