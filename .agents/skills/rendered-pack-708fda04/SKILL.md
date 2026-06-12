---
name: rendered-pack-708fda04
description: 'Use BEFORE adding/moving a dep in a publishable package (release-please/@themoltnet/*), or choosing dependencies vs devDependencies: private @moltnet/* bundled via Vite SSR MUST be devDependencies. Also check:pack errors, E404 installs, SSR externalize.'
moltnet:
  rendered_pack_id: 708fda04-8894-43fa-9018-3c1dad7e0997
  rendered_pack_cid: bafyreidfuk5iisxtsyno7gwtte6dzq52cm4za3iv5k5dfvkeucslgxtsaa
  source_pack_id: 6a70a5c3-c76b-4d7f-bdb9-e1d69de689bb
  bundled_at: 2026-06-05T15:10:48Z
---

# Context Pack 6a70a5c3-c76b-4d7f-bdb9-e1d69de689bb

- Created: 2026-06-05T15:01:20.951Z
- Entries: 6

### Release CI caught pi-extension private workspace dependency leak

- Entry ID: `b7751f1d-8aff-4ddf-96e1-785a13a4576a`
- CID: `bafkreicdobdqb4e6kzk3tr3yka2u3qtz2ifwalaz4sl25gzp7vmmu3rbay`
- Compression: `full`
- Tokens: 207/207

<metadata>
operator: edouard
tool: codex
timestamp: 2026-06-05T14:35:08Z
branch: main
scope: release-ci, pi-extension, publishing
refs: github-actions:27019843174/job/79745239458, libs/pi-extension/package.json, libs/pi-extension/vite.config.ts, tools/src/check-pack.ts
signer: 1671-B080-99BF-4270
</metadata>

Release workflow run 27019843174 failed in the Publish Pi Extension to npm job, not during the Vite JS build. The pi-extension build completed successfully, then pi-extension check:pack failed with: private workspace packages in dependencies, move to devDependencies if bundled: @moltnet/tasks.

Root cause: release-please produced @themoltnet/pi-extension version 0.21.0 with @moltnet/tasks under dependencies. @moltnet/tasks is a private workspace package and is not published to npm. Because pi-extension Vite SSR config already bundles @moltnet scoped private packages via ssr.noExternal, @moltnet/tasks belongs in devDependencies. This matches the prior legreffier and pi-extension publishing incidents.

Operational lesson: for any publishable package, private @moltnet scoped dependencies must never ship in dependencies. If they are imported and bundled, keep them in devDependencies. Keep published @themoltnet scoped packages in dependencies when consumers need them. Always run the package check:pack before release-please publish jobs.

### Incident: @themoltnet/legreffier published with unpublished workspace deps

- Entry ID: `2e99af04-6793-4fe3-89b5-1378c899bd67`
- CID: `bafkreifdkesqgvlw4rp7v637wscelohzv6w3plegjlgx27x3puiy7ucup4`
- Compression: `full`
- Tokens: 236/236

What happened: `npm i -g @themoltnet/legreffier` failed with E404 for `@moltnet/api-client@0.1.0`. The published package.json listed three private workspace packages (@moltnet/api-client, @moltnet/crypto-service, @moltnet/design-system) in `dependencies` instead of `devDependencies`. Vite SSR correctly bundled them into dist/index.js, but pnpm publish rewrote `workspace:*` to concrete versions and shipped references to packages that don't exist on npm.

Root cause: The legreffier package.json had workspace deps in `dependencies`. The SDK (which does it correctly) has them in `devDependencies`. The check:pack script validated tarball contents (dist files, source leaks, .d.ts imports) but never checked the `dependencies` field itself for private workspace packages.

Fix applied:

1. Moved @moltnet/api-client, @moltnet/crypto-service, @moltnet/design-system, @themoltnet/sdk from dependencies to devDependencies in packages/legreffier-cli/package.json
2. Extended scripts/check-pack.ts to detect @moltnet/\* packages in dependencies
3. Created .claude/skills/pre-publish/SKILL.md as a mandatory pre-publish checklist

Watch for: Any new publishable package must follow the SDK pattern — bundled workspace deps go in devDependencies. The check:pack script now catches this, but the pre-publish skill documents the full verification workflow.

<metadata>
operator: edouard
tool: claude
refs: packages/legreffier-cli/package.json, scripts/check-pack.ts, libs/sdk/package.json, .claude/skills/pre-publish/SKILL.md
timestamp: 2026-03-02T17:45:00Z
branch: worktree-fix-legreffier-publish
scope: scope:cli, scope:publish
</metadata>

### Accountable commit: Switch pi-extension build to vite + vite-plugin-dts with rollupTypes, matching the @themoltnet/sdk pattern.

- Entry ID: `c8d117f6-c05a-41be-9851-1bfac9c450eb`
- CID: `bafkreiezgjn2skzifroj3fho3aboomyynatdxwssinzqjdzisxv72cp2a4`
- Compression: `full`
- Tokens: 188/188

<content>
Switch pi-extension build to vite + vite-plugin-dts with rollupTypes, matching the @themoltnet/sdk pattern. Workspace deps (@moltnet/agent-runtime, @moltnet/tasks) move to devDependencies and get bundled into dist/index.js via SSR noExternal; their types get inlined into dist/index.d.ts via bundledPackages (needed because @moltnet/agent-runtime's TaskReporter interface re-exports TaskMessage/TaskUsage from @moltnet/tasks through a barrel export *, which api-extractor otherwise leaves as external imports). The ./runtime subpath is collapsed into the root index.ts so there is a single published entry point and check:pack can validate cleanly. Fixes CI check:pack failure on @themoltnet/pi-extension@0.4.0 (workspace imports leaking into .d.ts). Risk: medium — build system change affecting a published package, but tests pass and the SDK precedent has been in production for months.
</content>
<metadata>
signer: 1671-B080-99BF-4270
operator: edouard
tool: claude
risk-level: medium
files-changed: 7
refs: libs/pi-extension/package.json, libs/pi-extension/src/index.ts, libs/pi-extension/src/runtime/index.ts, libs/pi-extension/vite.config.ts, pnpm-lock.yaml
timestamp: 2026-04-22T11:42:56Z
branch: fix/curate-pack-prompt-packid
scope: pi-extension, build-system, publishing
</metadata>

### Accountable commit: Renames @moltnet/agent-runtime to @themoltnet/agent-runtime and publishes it as a standalone package.

- Entry ID: `a4eefe9a-f565-416b-ac1a-e06e6c17c876`
- CID: `bafkreigcowygtlhd7xik4wd4p32fvbq4z2bzfih5qgl3g5sxwc2bvca4xi`
- Compression: `full`
- Tokens: 143/143

<content>
Renames @moltnet/agent-runtime to @themoltnet/agent-runtime and publishes it as a standalone package. Switches its build from tsc -b to vite build SSR, bundling @moltnet/tasks (private) into the output and re-exporting its types so consumers need only one published dep. Updates @themoltnet/pi-extension to consume agent-runtime as a proper external dependency rather than bundling it, cleaning up vite.config.ts accordingly. Wires the new package into release-please and the CI publish workflow with a dedicated publish-agent-runtime job. Updates all import specifiers across pi-extension and tools.
</content>
<metadata>
signer: 1671-B080-99BF-4270
operator: edouard
tool: claude
risk-level: medium
files-changed: 17
refs: .github/workflows/release.yml, .release-please-manifest.json, demo/tasks/README.md, libs/agent-runtime/package.json, libs/agent-runtime/src/index.ts
timestamp: 2026-04-23T15:58:27Z
branch: feat/tasks-api-runtime-demo-2
scope: agent-runtime, pi-extension
</metadata>

### Accountable commit: Release CI failed because tools/src/check-pack.

- Entry ID: `034af63b-d3a8-4d83-982d-e0edad380b59`
- CID: `bafkreigqvoqjott5vopaseyebrqvsm5jc7zxf3f6zzysksdvrvejjunxh4`
- Compression: `full`
- Tokens: 114/114

<content>
Release CI failed because tools/src/check-pack.ts flagged @themoltnet/agent-runtime as having workspace-import leaks in its rolled-up dist/index.d.ts, when the matches were actually JSDoc text mentioning '@moltnet/tasks' and '@moltnet-*'. Tightened detection to match real module specifiers only (from/import/require/<reference types=>) and to first strip block and line comments, eliminating false positives while still catching genuine private-workspace import leaks. No build output, dependency, or release attribution change.
</content>
<metadata>
signer: 1671-B080-99BF-4270
operator: edouard
tool: claude
risk-level: medium
files-changed: 1
refs: tools/src/check-pack.ts
timestamp: 2026-05-10T10:24:47Z
branch: fix/agent-runtime-workspace-import-leak
scope: ci, release-tooling
</metadata>

### Vite 8 SSR external regex rejected by Rolldown

- Entry ID: `f04f21ba-2760-4310-811e-4590f30ce81f`
- CID: `bafkreicsmumdr7nt4pamz7nlodqhxr7memnjwcql7ffr7bt54xebifc2r4`
- Compression: `full`
- Tokens: 208/208

What happened: Upgrading the repo spike branch from Vite 6 to Vite 8 caused both SSR app builds (`@moltnet/rest-api` and `@moltnet/mcp-server`) to fail immediately during config resolution before bundling started. The shared symptom was `InvalidArg` on `BindingViteResolvePluginConfig.external` when Vite 8/Rolldown processed `ssr.external`.

Root cause: Both SSR app configs used a regex entry (`/^@opentelemetry\//`) inside `ssr.external`. Vite 6 accepted that shape, but Vite 8/Rolldown rejected it for these server builds.

Fix applied: Replaced the regex with explicit `@opentelemetry/*` package names in `apps/rest-api/vite.config.ts` and `apps/mcp-server/vite.config.ts`. After that change, both app builds passed, both unit test suites passed, and both Docker image builds passed.

Watch for: Treat Vite 8 as a config migration rather than a drop-in version bump for SSR apps. Re-check bundle shape and Docker `pnpm deploy --legacy --prod` whenever changing externalization rules.

<metadata>
operator: edouard | tool: codex | timestamp: 2026-04-01T10:41:19Z
branch: feat/579-vite-8-spike | scope: build,tooling | refs: apps/rest-api/vite.config.ts, apps/mcp-server/vite.config.ts, pnpm-workspace.yaml, pnpm-lock.yaml, apps/rest-api/Dockerfile
signer: 1671-B080-99BF-4270
</metadata>
