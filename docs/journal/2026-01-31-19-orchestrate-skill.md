---
date: '2026-01-31T15:40:00Z'
author: claude-opus-4-5-20251101
session: unknown
type: handoff
importance: 0.6
tags: [handoff, orchestration, skill, multi-agent, sandbox]
supersedes: null
signature: pending
---

# Handoff: Orchestrate Skill for Multi-Agent Task Distribution

## What Was Done This Session

- Created `/orchestrate` skill at `.claude/skills/orchestrate/SKILL.md` with 6 actions:
  - **Analyze**: parse TASKS.md + GitHub Issues, resolve dependencies, classify tasks as ready/soon/blocked
  - **Plan**: wave-based distribution with conflict detection
  - **Spawn**: worktree creation with optional Docker sandbox mode (Desktop 4.58+)
  - **Launch**: generate self-contained `claude -p` prompts in 4 formats (individual, tmux, background, sandbox)
  - **Monitor**: worktree + sandbox + PR + CI + stale branch detection
  - **Cleanup**: merge PRs, teardown worktrees/sandboxes, delete stale branches, re-analyze
- Fixed `npm` -> `pnpm` in `scripts/orchestrate.sh`, `docs/AGENT_COORDINATION.md`, `.claude/commands/handoff.md`
- Deleted 15 stale remote branches that were fully merged into main
- Added GitHub Issues as supplementary task source with label-based metadata mapping

## What's Not Done Yet

- The skill hasn't been tested end-to-end (manual verification needed)
- No `.sandbox-include` file exists yet for this repo
- The skill doesn't integrate with the official `using-git-worktrees` superpowers plugin

## Current State

- Branch: `claude/orchestrate-skill`
- PR: #20
- CI: Mission Integrity was failing (fixed by adding checklist to PR body), Journal Entry was failing (fixed by adding this entry)
- Build: no code changes to compiled output, only markdown and shell script

## Decisions Made

- GitHub Issues are supplementary, not primary — TASKS.md remains the coordination board agents read/write
- Docker sandbox is opt-in per spawn, not default — bare worktrees are simpler and don't require Docker Desktop
- Stale branch cleanup is part of the Cleanup action rather than a separate action

## Open Questions

- Should the skill auto-detect whether Docker Desktop supports sandboxes and skip the prompt if unavailable?
- Should there be a `.sandbox-include` committed to the repo with sensible defaults?

## Where to Start Next

1. Merge PR #20 after CI passes
2. Test `/orchestrate` interactively — say "what's ready?" and verify output
3. Consider creating `.sandbox-include` with `.claude` and `node_modules/.cache`
