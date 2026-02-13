# Homebrew Tap + npm CLI Wrapper

- **Date**: 2026-02-13
- **Type**: handoff
- **Status**: Ready for review

## What Was Done

Added two new distribution channels for the MoltNet Go CLI:

### Homebrew Tap (`brew install getlarge/moltnet/moltnet`)

- Added `release.disable: true` to `.goreleaser.yml` (release-please owns the GitHub release)
- Added `brews` section to `.goreleaser.yml` that pushes a Homebrew formula to `getlarge/homebrew-moltnet`
- Uses a GitHub App token (`actions/create-github-app-token@v1`) for cross-repo push
- Changed GoReleaser from `--skip=publish,validate` to `--skip=validate` so the `brews` publisher runs

### npm Wrapper (`npx @themoltnet/cli register -voucher <code>`)

- Created `packages/cli/` as a standalone npm package (not in pnpm workspace)
- `install.js`: postinstall script that downloads the correct binary from GitHub Releases, verifies SHA256 checksum, extracts with system tar/PowerShell
- `bin/moltnet.js`: thin wrapper that `execFileSync`s the binary and propagates exit codes
- Zero dependencies — uses only Node.js builtins (`https`, `crypto`, `fs`, `child_process`)
- Handles GitHub CDN redirects (up to 5 hops)

### Release workflow updates

- Fixed `gh release upload` glob to only match `*.tar.gz`, `*.zip`, `checksums.txt` (was matching directories)
- Added `publish-cli-npm` job that runs after `release-cli` with npm provenance
- Added `extra-files` in `release-please-config.json` to sync `packages/cli/package.json` version automatically

## What's Not Done

- The `getlarge/homebrew-moltnet` repo needs to exist on GitHub (user confirmed manual setup done)
- GitHub App secrets (`MOLTNET_RELEASE_APP_ID`, `MOLTNET_RELEASE_APP_KEY`) need to be in repo settings (user confirmed)
- `NPM_TOKEN` secret needed for npm publishing
- End-to-end verification will happen on next CLI release

## Current State

- **Branch**: `claude/homebrew-npm-cli-wrapper`
- **Files modified**: `.goreleaser.yml`, `release.yml`, `release-please-config.json`, `.gitignore`
- **Files created**: `packages/cli/package.json`, `packages/cli/install.js`, `packages/cli/bin/moltnet.js`

## Decisions Made

1. **Standalone npm package**: `packages/cli/` is deliberately outside the pnpm workspace to avoid polluting lint/typecheck/build pipelines — it's pure JS with no build step
2. **GitHub App token** (not PAT): used `actions/create-github-app-token` for the Homebrew tap push — scoped to only `homebrew-moltnet`, rotates automatically
3. **Zero dependencies**: `install.js` uses only Node.js builtins to keep the package minimal and avoid supply chain risk
4. **release.disable: true**: GoReleaser doesn't create/manage the GitHub release (release-please does), but it still runs the `brews` publisher

## Open Questions

- Should `install.js` support a `MOLTNET_BINARY_MIRROR` env var for air-gapped environments?
- Should we add a `--version` flag to the npm wrapper itself (distinct from `moltnet version`)?

## Where to Start Next

1. Verify `NPM_TOKEN` is set in repo secrets
2. After next CLI version bump, verify both channels work end-to-end
3. Consider adding `packages/cli/README.md` with install instructions
