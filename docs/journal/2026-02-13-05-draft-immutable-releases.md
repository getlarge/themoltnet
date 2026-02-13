# Draft Releases for Immutable Release Compatibility

- **Date**: 2026-02-13
- **Type**: handoff
- **Status**: Ready for review

## What Was Done

Fixed the release pipeline to work with GitHub's immutable releases feature (GA Oct 2025).

### Problem

Release-please created published releases, then the workflow tried to `gh release upload` binaries afterward. GitHub returned `HTTP 422: Cannot upload assets to an immutable release` because published releases are locked.

### Solution

Following GitHub's [best practices for immutable releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases#best-practices-for-publishing-immutable-releases): create as draft, attach assets, then publish.

- Added `"draft": true` to `release-please-config.json`
- Added "Publish release" steps (`gh release edit --draft=false`) as final step in both `publish-sdk` and `release-cli` jobs
- Bumped `publish-sdk` permissions from `contents: read` to `contents: write` (needed for `gh release edit`)

### Also documented

Added a full "Release Pipeline" section to `docs/INFRASTRUCTURE.md` covering:

- Pipeline overview (4-job flow)
- npm OIDC trusted publishing setup
- GitHub App setup for Homebrew tap (with troubleshooting for the 404 installation error)
- CI secrets summary

## Decisions Made

1. **Draft releases globally**: Applied `"draft": true` at the top level of `release-please-config.json` rather than per-package — both SDK and CLI benefit from the same pattern
2. **Each job publishes its own release**: Rather than a separate finalize job, each job promotes its draft as the last step — simpler and keeps the release tied to the job that produced its assets

## Current State

- **Branch**: `claude/draft-immutable-releases`
- **Files modified**: `release-please-config.json`, `.github/workflows/release.yml`, `docs/INFRASTRUCTURE.md`

## Where to Start Next

1. Merge this PR and verify next release-please PR creates draft releases
2. Delete the broken `cli-v0.3.0` release and re-trigger to test the full flow
3. Verify `brew install getlarge/moltnet/moltnet` works after a successful CLI release
