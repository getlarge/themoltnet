---
date: '2026-02-14T17:00:00Z'
author: claude-opus-4-6
session: session_01BkmxwWWa128PGsztrtQiuo
type: handoff
importance: 0.7
tags: [handoff, ws8, openclaw, skill, clawhub, release]
supersedes: null
signature: pending
---

# Handoff: OpenClaw Skill Package (ClawHub + GitHub Release)

## What Was Done This Session

- Researched npm trusted publishing (OIDC, provenance) — determined npm is wrong channel for a markdown skill
- Researched OpenClaw's native distribution: ClawHub registry (`clawdhub publish`), skill directory conventions
- Wrote implementation plan at `docs/plans/2026-02-14-openclaw-skill-package.md`
- Created skill directory at `packages/openclaw-skill/` with:
  - `version.txt` (0.1.0) for Release Please simple versioning
  - `SKILL.md` with YAML frontmatter, full tool reference tables, usage guidelines
  - `mcp.json` with SSE transport + OAuth2 auth template
- Created publish scripts:
  - `scripts/publish-clawhub.sh` — ClawHub publish with --dry-run, --changelog, --help
  - `scripts/package.sh` — tarball packaging for GitHub Release assets
- Wired into Release Please (`release-type: simple`, component: `openclaw-skill`)
- Added release workflow jobs: `release-skill` (tarball + GH Release) + `publish-skill-clawhub`
- Added CI `skill-check` job (validates SKILL.md frontmatter, mcp.json, version.txt, tarball)
- Added root convenience scripts: `publish:skill`, `publish:skill:dry-run`, `package:skill`
- All checks passing: lint, typecheck, test, build, check:pack

## What's Not Done Yet

- ClawHub account setup + `CLAWDHUB_TOKEN` secret in GitHub repo settings
- Actual first publish to ClawHub (needs account + token)
- MoltNet CLI `moltnet skill install` command (future work, documented in plan)
- PR not yet created

## Current State

- Branch: `claude/openclaw-skill-voucher-harvp`
- Tests: all passing (`pnpm run validate` green)
- Build: clean
- 8 commits since session start

## Decisions Made

- **ClawHub over npm**: Skills are markdown bundles, not npm packages. ClawHub is OpenClaw's native registry.
- **GitHub Release as fallback**: Tarball attached to releases for non-ClawHub users (`tar -xzf ... -C ~/.openclaw/skills/`)
- **`release-type: simple`**: Uses `version.txt` instead of `package.json` since there's no npm publishing
- **No install script**: ClawHub handles install (`clawdhub install moltnet`). Tarball extracts directly. No Node.js install script needed.
- **Skill files at directory root**: SKILL.md + mcp.json live at `packages/openclaw-skill/` root (not nested in `skill/` subdir) — matches ClawHub convention

## Open Questions

- ClawHub CI auth: is `CLAWDHUB_TOKEN` the right env var, or does `clawdhub` support `CLAWDHUB_CONFIG_PATH`?
- Should the `skill-check` CI job block the `build` job? Currently independent.

## Where to Start Next

1. Read this handoff entry
2. Set up ClawHub account and configure `CLAWDHUB_TOKEN` secret
3. Create PR from `claude/openclaw-skill-voucher-harvp` → `main`
4. After merge: first Release Please cycle will create the initial release
5. Future: add `moltnet skill install` to CLI (see plan's Future Work section)
