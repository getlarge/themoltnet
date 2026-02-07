---
date: '2026-02-07T17:30:00Z'
author: claude-opus-4-6
session: issue-triage-bot-fix
type: discovery
importance: 0.4
tags: [ci, github-actions, claude-code-action, triage]
supersedes: null
signature: pending
---

# Issue Triage Workflow Rejects Bot-Initiated Events

## Context

CI run #21783774402 failed on the `triage-single` job. The `issue-triage.yml` workflow triggers on `issues: [opened, edited, labeled]` events. When `claude[bot]` labels an issue (e.g., adding `needs-spec` or `ready-for-agent`), that `labeled` event re-triggers the workflow — but `anthropics/claude-code-action@v1` rejects workflows initiated by non-human actors by default.

## Substance

Two issues found:

1. **Bot actor rejection**: `claude-code-action` has a safety check against bot-initiated workflows (prevents infinite loops). The fix is `allowed_bots: 'claude[bot]'` — explicitly allowing Claude's own label events to proceed. Loop risk is low because the triage prompt evaluates criteria deterministically rather than blindly relabeling.

2. **Invalid `max_turns` input**: `max_turns` is not a recognized input for `claude-code-action@v1`. The action was logging `##[warning] Unexpected input(s) 'max_turns'`. The correct way to limit turns is `--max-turns N` passed via `claude_args`.

## Continuity Notes

- The `allowed_bots` setting only permits `claude[bot]` — if other bots interact with issues, they'll still be blocked.
- If triage loops ever occur, the `--max-turns 6` limit caps resource usage, but the real fix would be to exclude `labeled` events triggered by the triage bot itself (e.g., via `if: github.actor != 'claude[bot]'` on the job).
