# Agent Coordination Framework

_A practical framework for orchestrating multiple AI agents on a shared codebase._

This framework is project-agnostic. It works with any git repository, any number of agents, and any Claude Code setup. MoltNet uses it, but it's designed to be copied into other repos.

---

## Overview

The problem: you have one repo, multiple agents (Claude Code sessions), and limited human attention. Agents need to work in parallel without conflicts, stay aware of each other's work, and integrate cleanly.

The solution has four layers:

| Layer            | Mechanism                              | Purpose                                              |
| ---------------- | -------------------------------------- | ---------------------------------------------------- |
| **Isolation**    | Git worktrees                          | Each agent gets its own working directory and branch |
| **Coordination** | GitHub Projects                        | Single source of truth for who's doing what          |
| **Awareness**    | PR monitoring + journal + Claude hooks | Agents check what others have shipped                |
| **Integration**  | PR-based merge + CI                    | Work merges through reviewed pull requests           |

---

## Layer 1: Isolation with Git Worktrees

Each agent works in its own git worktree — a separate checkout of the same repo that shares `.git` history but has independent files, branch, and `node_modules`.

### Why worktrees over branches

A branch is just a pointer. Two agents on different branches in the same directory will still overwrite each other's unstaged files. Worktrees give true filesystem isolation.

### Creating a worktree for an agent

```bash
# From the main repo directory
./scripts/orchestrate.sh spawn <task-name> [base-branch]

# Example: spawn an agent to work on the auth library
./scripts/orchestrate.sh spawn auth-library main

# This creates:
#   ../<repo>-auth-library/     (worktree directory)
#   branch: agent/auth-library  (new branch from base)
#   runs: pnpm install          (so node_modules exist)
```

### Launching Claude Code in the worktree

```bash
# Interactive (you watch it)
cd ../<repo>-auth-library && claude

# Headless (fire and forget)
cd ../<repo>-auth-library && claude -p "Run /sync, claim your task, implement it, create a PR when done."

# Background with logging
cd ../<repo>-auth-library && claude -p "..." > agent-auth.log 2>&1 &
```

### Docker sandbox (optional, stronger isolation)

If agents shouldn't touch your host filesystem:

```bash
# Requires Docker Desktop 4.50+
docker sandbox run --mount=../<repo>-auth-library claude
```

Or use Dagger's container-use for worktree + container in one step:

```bash
# Install: curl -fsSL https://raw.githubusercontent.com/dagger/container-use/main/install.sh | bash
# Then use via MCP — each agent gets its own container + worktree automatically
```

### Cleaning up worktrees

```bash
# Remove a single worktree
./scripts/orchestrate.sh teardown auth-library

# Remove all agent worktrees
./scripts/orchestrate.sh teardown-all

# List active worktrees
./scripts/orchestrate.sh list
```

---

## Layer 2: Coordination with GitHub Projects

GitHub Projects v2 is the coordination mechanism. It provides structured fields, a queryable API, and a visual board for human oversight.

### Project Board Fields

| Field            | Type          | Options                                             | Purpose                        |
| ---------------- | ------------- | --------------------------------------------------- | ------------------------------ |
| **Status**       | Single Select | `Todo`, `In Progress`, `In Review`, `Done`          | Workflow state                 |
| **Priority**     | Single Select | `P0: Critical`, `P1: High`, `P2: Medium`, `P3: Low` | Urgency                        |
| **Readiness**    | Single Select | `Draft`, `Needs Spec`, `Ready for Agent`            | Triage gate                    |
| **Effort**       | Single Select | `XS`, `S`, `M`, `L`, `XL`                           | Scope signal for agents        |
| **Agent**        | Text          | freetext                                            | Which agent/session claimed it |
| **Workstream**   | Single Select | `WS1`–`WS11`                                        | Maps to FREEDOM_PLAN.md        |
| **Dependencies** | Text          | Issue references like `#42, #45`                    | Blocks tracking                |

### How Agents Interact with the Board

Agents use `gh project` CLI commands to read the board and `gh issue` to claim tasks:

```bash
# Read all items
gh project item-list "$PROJECT_NUMBER" --owner "$PROJECT_OWNER" --format json

# Claim a task — assign the issue, which triggers project-automation.yml
# to automatically move Status to "In Progress"
gh issue edit <NUMBER> --add-assignee "@me"

# Update Agent field (still done manually via gh project item-edit)
gh project item-edit --id "$ITEM_ID" --project-id "$PROJECT_ID" \
  --field-id "$AGENT_FIELD_ID" --text "$AGENT_ID"
```

### GitHub Actions Automation

The `.github/workflows/project-automation.yml` workflow automates board transitions:

- **Issue assigned** → Status moves from `Todo` to `In Progress` (triggered by `/claim`)

This replaces the previous approach where agents had to manually run `gh project item-edit` to update the Status field. The workflow requires a `GH_PROJECT_TOKEN` secret with `project` read/write scope.

### Claude Code Hooks for Automatic Sync

Three hooks in `.claude/settings.json` automate the sync:

- **`SessionStart`** — polls the board on session startup, injects available tasks as context
- **`Stop`** (async) — after each response, checks for status changes to push back
- **`Notification (idle_prompt)`** — when idle, checks if PR was merged and surfaces the next task

The hooks call `scripts/agent-sync.sh` which handles all GitHub Projects API interaction.

### Issue Quality Gate

Issues are validated by a triage GitHub Action (`.github/workflows/issue-triage.yml`). An issue gets `Readiness: Ready for Agent` when it has:

1. Clear acceptance criteria
2. Context files listed
3. Dependencies declared
4. Single responsibility scope
5. Effort and priority set

Agents should only pick up items where `Readiness == Ready for Agent`.

---

## Layer 3: Awareness Through PR Monitoring

Agents should check what other agents have shipped before starting work. This prevents duplicate effort and catches integration issues early.

### What agents should check

1. **Open PRs** — what's in flight right now
2. **Recently merged PRs** — what landed since you last checked
3. **CI status** — is main broken

### Custom Claude Code commands

Install these by copying `.claude/commands/` into your repo. Agents use them as slash commands.

#### `/sync` — Check coordination state

Queries the GitHub Project board, lists open PRs, checks CI status. Run this at the start of every session.

#### `/claim` — Claim a task

Claims a task on the GitHub Project board (sets Status to "In Progress" and Agent field).

#### `/handoff` — End-of-session handoff

Writes a journal entry, updates the project board, creates a PR if work is ready.

### Periodic awareness (for long sessions)

Agents on long-running tasks should re-sync periodically:

```
Every ~30 minutes of work or before starting a new subtask:
1. git fetch origin main
2. Run /sync to check the project board for status changes
3. Check if any new PRs touch files you're modifying
4. If main has changes relevant to your work, rebase
```

This is a guideline, not a hard rule. The custom commands make it easy.

---

## Layer 4: Integration Through PRs

All work merges through pull requests. No direct pushes to main.

### Agent PR workflow

1. Agent works on its branch in its worktree
2. Agent commits frequently (small, atomic commits)
3. When the task is done, agent runs `gh pr create`
4. CI runs (lint, typecheck, test, build)
5. Human reviews and merges (or another agent reviews — see below)

### PR template for agents

```markdown
## Summary

- <what was built/changed>

## Task

- From project board: <task name> (#<issue number>)
- Workstream: <WS number if applicable>

## Changes

- <file-level summary of what changed>

## Testing

- [ ] All existing tests pass
- [ ] New tests added for new functionality
- [ ] Tested against dependencies (if applicable)

## Coordination

- Depends on: <list PRs or "none">
- Blocks: <list tasks or "none">
- Files shared with other agents: <list or "none">
```

### Agent-to-agent review (optional)

For teams running many agents, one agent can review another's PR:

```bash
# Launch a review agent
claude -p "Review PR #42. Check for: correctness, test coverage, adherence to project conventions in CLAUDE.md. Post your review as a GitHub comment."
```

---

## The Orchestrator's Role (You, the Human)

You are the orchestrator. Your job is:

1. **Define tasks** — create issues on the GitHub Project board
2. **Spawn agents** — use `./scripts/orchestrate.sh spawn` for each task
3. **Monitor progress** — check PRs, check the project board, check CI
4. **Resolve conflicts** — when agents step on each other, you decide
5. **Merge PRs** — you're the final gate (or delegate to a review agent)
6. **Unblock agents** — when an agent is stuck, provide context or make a decision

### Typical session

```bash
# 1. Create issues on the project board (via GitHub UI or gh CLI)
gh issue create --title "Build auth library" --label agent-task --body "..."

# 2. Spawn agents for independent tasks
./scripts/orchestrate.sh spawn auth-library main
./scripts/orchestrate.sh spawn diary-service main

# 3. Launch agents (in separate terminals or tmux panes)
cd ../moltnet-auth-library && claude
cd ../moltnet-diary-service && claude

# 4. Monitor
./scripts/orchestrate.sh status  # see all worktrees + branches
gh pr list                       # see open PRs
gh run list                      # see CI status

# 5. Merge and iterate
gh pr merge 5 --squash
# Spawn next wave of agents
```

### Using tmux for multi-agent management

```bash
# Create a session with panes for each agent
tmux new-session -d -s agents
tmux split-window -h
tmux split-window -v

# Pane 0: auth-library agent
tmux send-keys -t agents:0.0 'cd ../moltnet-auth-library && claude' C-m

# Pane 1: diary-service agent
tmux send-keys -t agents:0.1 'cd ../moltnet-diary-service && claude' C-m

# Pane 2: monitoring
tmux send-keys -t agents:0.2 'watch -n 30 "gh pr list && echo --- && gh run list --limit 5"' C-m

tmux attach -t agents
```

---

## Conflict Prevention

The best way to handle conflicts is to prevent them.

### File ownership boundaries

Assign non-overlapping file boundaries to each agent:

```
Agent A (auth-library):     libs/auth/**
Agent B (diary-service):    libs/diary-service/**
Agent C (mcp-server):       apps/mcp-server/**
```

Shared files (`package.json`, `tsconfig.json`) are the main conflict source. Minimize changes to shared files, and when they must change, make them small and atomic.

### Dependency ordering

Some tasks depend on others. Don't parallelize what must be sequential:

```
WS3 (diary-service) ─┐
                      ├─→ WS5 (MCP server)
WS4 (auth-library)  ─┘
```

The orchestrator ensures dependent tasks only start when dependencies are merged.

### Rebase strategy

Agents should rebase on main before creating PRs:

```bash
git fetch origin main && git rebase origin/main
```

If conflicts arise during rebase, the agent resolves them or flags the human.

---

## Scaling Up

### More agents on one machine

Each worktree + Claude Code session uses:

- ~200-500MB disk (node_modules per worktree)
- ~100-300MB RAM (node process + Claude Code CLI)
- One API connection to Anthropic

A typical dev machine can run 3-5 concurrent agents comfortably. More is possible but watch memory.

### Across machines

The framework works across machines because git + GitHub Projects is the coordination layer:

1. All machines clone the same repo
2. All agents push to the same remote
3. The project board syncs via `gh` CLI
4. PRs are visible to everyone via GitHub

No shared filesystem or message bus needed.

### CI as the integration test

Your CI pipeline is the final arbiter. If an agent's PR passes CI, the code is integration-safe. If it fails, the agent (or a new agent) fixes it.

---

## Quick Reference

### For the orchestrator (human)

```bash
./scripts/orchestrate.sh spawn <task> [base]  # Create worktree + branch
./scripts/orchestrate.sh list                  # Show active worktrees
./scripts/orchestrate.sh status                # Worktrees + PR + CI summary
./scripts/orchestrate.sh teardown <task>       # Remove a worktree
./scripts/orchestrate.sh teardown-all          # Remove all agent worktrees
```

### For agents (Claude Code)

```
/sync              # Check project board, open PRs, CI status
/claim <task>      # Claim a task from the project board
/handoff           # End session: journal entry + board update + PR
```

### For agents (programmatic)

```bash
# Start of session
source env.public
gh project item-list "$MOLTNET_PROJECT_NUMBER" --owner "$MOLTNET_PROJECT_OWNER" --format json
# Find an available task, claim it, start working

# End of session
# Update project board status, commit, push, create PR
gh pr create --title "..." --body "..."
```

---

## Adapting for Other Projects

This framework is portable. To use it in another repo:

1. Copy `docs/AGENT_COORDINATION.md` (this file)
2. Copy `scripts/orchestrate.sh` and `scripts/setup-project.sh`
3. Copy `.claude/commands/` (sync, claim, handoff)
4. Run `./scripts/setup-project.sh` to create the GitHub Project board
5. Add a section to your project's `CLAUDE.md` pointing agents to this framework

The journal protocol (`docs/BUILDER_JOURNAL.md`) is optional but recommended for projects where context continuity matters across sessions.
