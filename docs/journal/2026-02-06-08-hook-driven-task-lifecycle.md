---
date: '2026-02-06T18:00:00Z'
author: claude-opus-4-6
session: unknown
type: handoff
importance: 0.7
tags: [handoff, hooks, automation, agent-coordination, lifecycle]
supersedes: 2026-02-06-02-github-projects-agent-sync.md
signature: pending
---

# Handoff: Hook-Driven Task Lifecycle Automation

## What Was Done This Session

- Extended `scripts/agent-sync.sh` with phase-driven lifecycle automation (+310 LOC)
  - Added `create_pr()`: idempotent PR creation with mission integrity checklist
  - Added `poll_checks()`: CI status polling with 2-minute backoff
  - Added `check_merged_and_close()`: merge detection and closure prompt
  - Added `close_issue_and_cleanup()`: issue closure, board update, signal file deletion
  - Added helpers: `read_claim_field`, `write_claim_field`, `write_claim_field_raw`, `emit_context`
  - Modified `on-stop` to dispatch by signal file phase instead of always syncing+deleting
  - Modified `on-idle` to check merged state before polling checks (prevents double-emit)
- Updated `.claude/commands/claim.md` — step 6 writes `.agent-claim.json` with `phase: coding`
- Updated `.claude/commands/handoff.md` — replaced manual PR creation with `phase: ready_for_pr` signaling, added post-merge closure flow
- Updated `.claude/settings.json` — added bash permissions for `gh pr/issue` commands, removed `async: true` from Stop hook (needed for additionalContext return), increased Stop timeout to 30s
- Added `.agent-claim.json` to `.gitignore`
- Wrote `docs/TASK_LIFECYCLE.md` — full documentation with 4 Mermaid diagrams (state machine, sequence diagram, two flowcharts)

## What's Not Done Yet

- No automated tests for `agent-sync.sh` (could add BATS tests)
- The `/sync` command doesn't show signal file state — could surface current phase
- No recovery mechanism if signal file gets corrupted or out of sync
- Haven't tested the full lifecycle end-to-end against a real issue

## Current State

- Branch: `claude/hook-driven-task-lifecycle`
- Pushed to origin
- Tests: N/A (shell script, no vitest coverage)
- Build: N/A (no TypeScript changes)
- Bash syntax: clean (`bash -n` passes)

## Decisions Made

- **Synchronous Stop hook**: Removed `async: true` from the Stop hook so `create_pr()` can return the PR URL via `additionalContext`. This adds latency to every response but is necessary for the agent to see the PR URL immediately.
- **Signal file persists across phases**: The old on-stop deleted `.agent-claim.json` unconditionally. Now it only deletes on `phase: done`. This is required for the state machine to work.
- **User confirms closure**: The hook detects merge but doesn't auto-close issues. It prompts the agent, which prompts the user. Keeps the human in the loop for destructive actions.
- **Cross-platform date parsing**: Backoff timestamp parsing uses macOS `date -j` with GNU `date -d` fallback.
- **Pre-checked mission integrity**: PR body has all 5 boxes checked. The agent is responsible for only setting `ready_for_pr` when the work actually meets criteria.

## Open Questions

- Should the on-idle hook also surface CI check status when there's no signal file? Currently it only does branch-based merge detection in that case.
- Is 2-minute backoff too aggressive or too conservative for CI polling?
- Should we add a `phase: failed` for when PR creation fails, to prevent retry loops?

## Where to Start Next

1. Read `docs/TASK_LIFECYCLE.md` for the full architecture
2. Test the lifecycle end-to-end: claim a real issue, implement something small, let hooks drive through to closure
3. Consider adding BATS tests for the shell functions
4. Consider adding signal file state to `/sync` output
