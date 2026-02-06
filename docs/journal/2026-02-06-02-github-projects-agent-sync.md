---
date: '2026-02-06T12:00:00Z'
author: claude-opus-4-6
session: session_0175f3hgxkevuji2nNTUbXop
type: handoff
importance: 0.8
tags: [handoff, coordination, github-projects, hooks, automation]
supersedes: null
signature: pending
---

# Handoff: GitHub Projects Agent Sync

## What Was Done This Session

Implemented the full GitHub Projects integration for agent coordination (issue #50):

- **4 new scripts**: `setup-project.sh` (creates board + fields), `setup-labels.sh` (20 labels), `agent-sync.sh` (hook-driven polling), `migrate-tasks-to-issues.sh` (TASKS.md migration)
- **Claude Code hooks**: 3 hooks in `.claude/settings.json` — SessionStart injects board state, Stop (async) pushes status changes, Notification (idle_prompt) checks for merged PRs and surfaces next task
- **Updated slash commands**: `/sync`, `/claim`, `/handoff` now use GitHub Projects as primary source with TASKS.md fallback
- **Issue triage workflow**: `.github/workflows/issue-triage.yml` validates issues against 5 quality criteria and sets `ready-for-agent` / `needs-spec` labels
- **Agent task template**: `.github/ISSUE_TEMPLATE/agent-task.yml` with required fields (acceptance criteria, context files, dependencies, workstream, effort, priority)
- **Updated docs**: `AGENT_COORDINATION.md` Layer 2 now covers GitHub Projects, orchestrate skill updated for 3-source priority

## What's Not Done Yet

- Project board not yet created on GitHub (requires `gh auth refresh -s project` + running `setup-project.sh`)
- Labels not yet created (requires running `setup-labels.sh`)
- TASKS.md items not yet migrated to issues (requires running `migrate-tasks-to-issues.sh`)
- `MOLTNET_PROJECT_NUMBER` in `.env.public` is empty — needs to be set after project creation
- The orchestrate skill's Action 2 (Plan) and Action 6 (Cleanup) could be further updated to use `gh project item-add` / `gh project item-edit` instead of TASKS.md edits

## Current State

- Branch: `claude/github-projects-agent-sync-wexy8`
- Tests: Not applicable (shell scripts + markdown + YAML config)
- Build: Not affected (no TypeScript changes)
- All shell scripts pass `bash -n` syntax check
- All JSON files pass validation
- 6 commits pushed to remote

## Decisions Made

1. **GitHub Projects v2 over v1** — v2 has proper API support via `gh project` CLI and GraphQL, custom field types, built-in automations
2. **Polling over webhooks** — GitHub Projects has no webhook support for field changes; polling via hooks is the pragmatic choice
3. **Three hook events** — SessionStart (inject state), Stop (push changes, async), Notification/idle_prompt (check merged PRs, surface next task)
4. **Graceful degradation** — Every script and command falls back silently when `gh` CLI is missing, project number isn't set, or API calls fail. TASKS.md remains functional as fallback.
5. **Triage agent via GitHub Actions** — not a persistent polling agent but an event-driven workflow (on issue create/edit) + periodic sweep (every 6 hours)
6. **5 quality criteria** for issue readiness: acceptance criteria, context files, dependencies declared, single responsibility, scoped effort
7. **Project board fields**: Status (5 options), Priority (P0-P3), Readiness (Draft/Needs Spec/Ready for Agent), Effort (XS-XL), Workstream (WS1-WS11), Agent (text), Dependencies (text)

## Open Questions

- Should TASKS.md be kept permanently as a human-readable snapshot, or deprecated entirely after migration?
- Should the triage agent use `claude-code-action` (current) or a lighter GitHub Action for label management?
- Should agents auto-claim the highest priority Ready item, or always wait for explicit `/claim`?
- Is the `on-idle` hook reliable enough for autonomous task chaining, or does it need a more explicit trigger?

## Where to Start Next

1. Run the setup scripts on the real repo:
   ```bash
   gh auth refresh -s project
   ./scripts/setup-labels.sh
   ./scripts/setup-project.sh
   ```
2. Set `MOLTNET_PROJECT_NUMBER` in `.env.public`
3. Run migration: `./scripts/migrate-tasks-to-issues.sh --dry-run` then without `--dry-run`
4. Test the hooks by starting a new Claude Code session and checking if the SessionStart hook fires
5. Create a test issue using the agent-task template and verify the triage workflow labels it
