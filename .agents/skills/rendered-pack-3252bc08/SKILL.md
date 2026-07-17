---
name: rendered-pack-3252bc08
description: 'Use BEFORE changing deps in publishable MoltNet packages: public in-repo @themoltnet/* deps use workspace:* for pnpm publish rewrite; private @moltnet/* bundled by Vite SSR stay in devDependencies; check release-please lockfile drift.'
metadata:
  moltnet.rendered_pack_id: '3252bc08-7a18-4410-a986-517f12eebc49'
  moltnet.rendered_pack_cid: 'bafyreiekoy55nnwdl5c3z4gmmckivmznncrucg34bgjrdfcuxgislijexe'
  moltnet.source_pack_id: '13cae84a-3ecd-4fdc-b4a3-13fbfcc62705'
  moltnet.bundled_at: '2026-06-26T07:59:36Z'
---

# Publishable Package Dependency Rules

Use this guidance before changing dependencies in any publishable MoltNet
package, especially packages managed by release-please or published under
`@themoltnet/*`.

## Rules

1. Public in-repo `@themoltnet/*` packages should use pnpm workspace protocol
   in repository manifests, for example `workspace:*`.

   Why: pnpm links the local workspace package during development and rewrites
   the dependency to the published package version during `pnpm publish`.
   A plain npm semver range lets release-please edit the package manifest
   without regenerating `pnpm-lock.yaml`, which can break
   `pnpm install --frozen-lockfile`.

2. Private `@moltnet/*` packages must not ship in `dependencies`.

   If a publishable package imports private `@moltnet/*` code and Vite SSR
   bundles it into `dist`, keep that private package in `devDependencies`.
   The published tarball must not reference private workspace packages that npm
   cannot install.

3. Runtime external public packages belong in `dependencies`.

   If consumers need a public package at runtime, keep it in `dependencies`, but
   still use `workspace:*` inside the monorepo when that package is part of this
   workspace.

4. Check both package manifests and generated package output.

   Before publishing or merging release-please changes, run the package's
   `check:pack`, verify `pnpm install --frozen-lockfile`, and inspect whether
   release-please changed dependency specifiers without a lockfile update.

## Failure Patterns

- Node-RED release drift: `libs/node-red-contrib-core` used
  `@themoltnet/sdk` as a plain semver dependency. Release-please changed the
  range from `^0.112.0` to `^0.113.0`, but the lockfile still recorded
  `^0.112.0`, so release CI failed before build or publish. The fix was to use
  `workspace:*` and regenerate the lockfile with pnpm.

- Private workspace dependency leak: `@themoltnet/pi-extension` and
  `@themoltnet/legreffier` previously shipped private `@moltnet/*` workspace
  packages in `dependencies`. npm installs then failed with E404 or check:pack
  blocked the release. The fix pattern is to bundle private code with Vite SSR
  and keep those private imports in `devDependencies`.

- Check-pack false positives: `tools/src/check-pack.ts` once flagged workspace
  imports that only appeared in comments/JSDoc. Detection must match actual
  module specifiers, not prose.

- Vite SSR externalization drift: Vite 8/Rolldown rejected regex entries in
  `ssr.external`; externalization rules should be retested when Vite changes.

## Provenance

- Node-RED SDK lockfile drift incident:
  `8fe07443-036c-4e5c-9e13-0fa8e069ea7c`
- Pi-extension private dependency leak:
  `b7751f1d-8aff-4ddf-96e1-785a13a4576a`
- Legreffier unpublished workspace dependency incident:
  `2e99af04-6793-4fe3-89b5-1378c899bd67`
- Pi-extension Vite publishing pattern:
  `c8d117f6-c05a-41be-9851-1bfac9c450eb`
- Agent-runtime standalone publish decision:
  `a4eefe9a-f565-416b-ac1a-e06e6c17c876`
- check:pack false-positive fix:
  `034af63b-d3a8-4d83-982d-e0edad380b59`
- Vite 8 SSR externalization incident:
  `f04f21ba-2760-4310-811e-4590f30ce81f`
