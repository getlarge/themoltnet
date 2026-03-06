---
date: '2026-03-03T11:30:00Z'
author: legreffier
session: fix-release-workflow-draft-resilience
type: handoff
importance: 0.8
tags: [ci, release-please, draft-releases, workflow-dispatch, npm-publish]
supersedes: null
signature: 9e647e5d-e3e9-4494-bb45-0e3f2b0d4ee8
---

# Fix: Release Workflow Resilient to Draft Release Failures

## Context

LeGreffier npm packages (v0.5.1, v0.6.0) were never published despite release-please PRs being merged successfully. The publish jobs were always skipped because `release_created` output was never set to `true`. This left multiple draft GitHub releases permanently orphaned.

## Root Cause

Known release-please bug ([googleapis/release-please-action#962](https://github.com/googleapis/release-please-action/issues/962)). With `"draft": true` in config, GitHub does not create git tags for draft releases ("lazy tag creation"). On subsequent pushes to main, release-please can't find the tag for the version in the manifest, says "No latest release found," and never sets `releases_created`. The publish job — gated on this output — is skipped. The draft stays draft forever.

Other packages (sdk, cli) avoided this because they had prior non-draft releases as anchors. LeGreffier hit it because its first release after `draft: true` failed the publish path.

## What Changed

### 1. `release-please-config.json` — `force-tag-creation: true`

The official fix from release-please docs. Creates git tags immediately even for draft releases, preventing the stuck state where release-please can't find previous releases.

### 2. `.github/workflows/release.yml` — structural overhaul

- **`workflow_dispatch` trigger**: accepts a `republish` input (comma-separated package names) for manual recovery of orphaned drafts
- **`resolve-publish` job**: merges release-please outputs with manual republish inputs. For republish, it looks up the latest draft release by component prefix. All downstream jobs now depend on `resolve-publish` outputs instead of `release-please` directly
- **`release-please` job**: now conditional on `github.event_name == 'push'` (skipped on manual dispatch)
- **`release-api-client`**: idempotent tag push (checks if tag exists before creating)

### 3. `.claude/skills/legreffier/SKILL.md` — CLI invocation fix

Changed `moltnet sign` to `npx @themoltnet/cli sign` throughout the skill. The bare `moltnet` binary (installed via Homebrew) was blocked by macOS Gatekeeper.

## Recovery Path

For any orphaned draft releases:

```bash
gh workflow run release.yml -f republish=legreffier
# or multiple: gh workflow run release.yml -f republish=sdk,legreffier,github-agent
```

## Mission Integrity Check

- **Agent sovereignty**: No impact — this is CI infrastructure only
- **Key management**: No changes to crypto paths
- **Supply chain**: `force-tag-creation` is a documented release-please option, not a custom patch
- **Centralization**: No new vendor dependencies added

## What's Next

- Monitor the next release-please cycle to confirm `force-tag-creation` resolves the stuck state
- Clean up remaining orphaned draft releases (legreffier-v0.5.1) using the new workflow_dispatch
- Consider whether `draft: true` is worth keeping at all — it adds complexity for minimal benefit (the window between release creation and artifact upload is seconds)
