---
type: handoff
date: 2026-02-08
sequence: 01
agent: claude-opus-4-6
branch: claude/project-automation
---

# Project Board Automation & Stop Hook Bugfix

## What was done

1. **Diagnosed why `/claim` wasn't moving issues to "In Progress"** — GitHub Projects v2 has no built-in "when assigned, move to In Progress" workflow. The `/claim` command relied on agents manually running `gh project item-edit`, which was unreliable.

2. **Created `.github/workflows/project-automation.yml`** — GitHub Actions workflow triggered on `issues: [assigned]` that automatically moves the board item from "Todo" to "In Progress" via GraphQL. Uses `GH_PROJECT_TOKEN` secret.

3. **Simplified `.claude/commands/claim.md`** — removed manual `gh project item-edit` for Status (now handled by the Actions workflow). Agent still updates the Agent field manually. Steps renumbered (6 → 5).

4. **Fixed stop hook crash in `scripts/agent-sync.sh`** — `close_issue_and_cleanup()` was calling `update_item_text "$item_id" "Agent" ""` which fails with "no changes to make" (exit 1) when the field is already empty. With `set -euo pipefail`, this prevented the signal file from being deleted, causing the error to repeat on every stop. Added `|| true` to board update calls in cleanup.

5. **Updated documentation**:
   - `docs/AGENT_COORDINATION.md` — documented Actions automation under Layer 2
   - `docs/TASK_LIFECYCLE.md` — added Participants row, updated claim sequence diagram, added "GitHub Projects Automation" section documenting all 9 built-in workflows and the custom Actions workflow, updated Files Involved table

6. **Cleaned up stale `.agent-claim.json`** from the main repo (phase: "done" for issue #117, stuck due to the bug above).

## What's not done

- The `GH_PROJECT_TOKEN` secret has been created by the user but the workflow hasn't been tested end-to-end yet (needs a merge to main first, then an issue assignment).
- The workflow hardcodes `projectNumber = 3` and `owner = 'getlarge'` — could be parameterized via env vars if the project number changes.

## Current state

- **Branch**: `claude/project-automation` (worktree at `../themoltnet-project-automation`)
- **Files changed**: 4 modified + 1 new
- **Tests**: no new tests (workflow is GitHub Actions, tested via deployment)
- **Build**: no code changes that affect build

## Decisions made

- **GitHub Actions over draft PR approach** — creating draft PRs on claim to trigger the "Pull request linked to issue" workflow was considered but rejected as it creates noise (stale draft PRs) and is a workaround.
- **Best-effort board cleanup** — added `|| true` to board updates in `close_issue_and_cleanup()` rather than adding complex error handling. The cleanup (deleting signal file, emitting context) should always proceed even if a board API call fails.

## Open questions

- Should the workflow also handle unassignment (move back to "Todo" when unassigned)?
- Should the `projectNumber` and `owner` be read from `env.public` instead of hardcoded in the workflow?

## Where to start next

1. Merge this PR and test by assigning an issue
2. Verify the stop hook no longer errors (stale signal file was removed)
