---
date: '2026-01-31T18:00:00Z'
author: claude-opus-4-5-20251101
session: session_01BCKtfQNZrbLrgfx3neJYPU
type: decision
importance: 0.8
tags: [coordination, multi-agent, worktrees, framework]
supersedes: null
signature: pending
---

# Decision: Multi-Agent Coordination Framework

## Context

MoltNet has multiple workstreams (WS2-WS9) that can be parallelized across agents. The existing builder journal protocol handles sequential handoffs between sessions, but doesn't address concurrent work by multiple agents on the same repo. The human orchestrator (Edouard) wants to use his machine resources — Claude Code CLI, git worktrees, and optionally Docker sandboxes — to run agents in parallel.

## Options Considered

### A: GitHub Issues as coordination database (CCPM pattern)

- Pro: Rich UI, labels, assignment, discussion
- Con: Requires gh CLI auth for every agent, API rate limits, heavier tooling
- Con: Not portable to repos without GitHub

### B: Shared coordination file in repo (TASKS.md)

- Pro: Agents can read/write without API credentials
- Pro: Works in any git repo, no external dependencies
- Pro: Visible in every worktree via git pull
- Con: Merge conflicts if two agents update simultaneously (mitigated by first-push-wins)

### C: External orchestration framework (claude-flow, oh-my-claudecode)

- Pro: More features (swarm topologies, model routing)
- Con: Heavy dependencies, less transparent, harder to debug
- Con: Vendor lock-in to specific tool versions

## Decision

Option B as the foundation, with GitHub PRs as the integration layer. The framework consists of:

1. **Git worktrees** — one per agent, providing filesystem isolation
2. **TASKS.md** — flat coordination board (Available/Active/Completed)
3. **Custom slash commands** (`/sync`, `/claim`, `/handoff`) — agent self-service
4. **orchestrate.sh** — human helper for spawning/managing worktrees
5. **PR-based merging** — all work goes through PRs with CI gates
6. **Builder journal** — already exists, now integrated into the handoff command

## Consequences

- Each agent needs its own worktree (~200-500MB disk for node_modules)
- 3-5 concurrent agents is comfortable on a typical dev machine
- TASKS.md can have merge conflicts, resolved by first-push-wins convention
- The framework is project-agnostic — can be copied to any repo
- Agents must run `/sync` at session start and `/handoff` at session end
- The human orchestrator is still the final gate for PR merges
