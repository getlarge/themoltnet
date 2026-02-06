# Orchestrate — Multi-Agent Task Distribution

You are the orchestrator's automation layer. The human orchestrator runs `/orchestrate` to get help analyzing the task board, planning parallel work distribution, spawning agent worktrees, generating agent prompts, monitoring progress, and cleaning up after waves complete.

**Context**: This project uses git worktrees for agent isolation, GitHub Projects as the coordination board, and `scripts/orchestrate.sh` for worktree mechanics. Agent-side commands (`/sync`, `/claim`, `/handoff`) already exist. This skill automates the human side.

**Task Source**: GitHub Projects (the project board with structured fields: Status, Priority, Readiness, Effort, Agent, Workstream, Dependencies). Requires `gh` CLI and `MOLTNET_PROJECT_NUMBER` env var (set in `env.public`).

## How to Respond

When the user invokes this skill, determine which action they want based on their message. If unclear, show a brief menu of the 6 actions. Then execute that action.

---

## Action 1: Analyze

**Triggers**: "what's ready?", "what can we parallelize?", "analyze tasks", "show dependencies", or invoked with no specific request.

Query the GitHub Project board and classify every item into one of three categories.

### Gathering Tasks

```bash
gh project item-list "${MOLTNET_PROJECT_NUMBER}" --owner "${MOLTNET_PROJECT_OWNER:-getlarge}" --format json
```

This returns items with their project fields (Status, Priority, Readiness, Effort, Agent, etc.).

### Dependency Resolution

For each item with Status "Todo":

1. Read the **Dependencies** text field.
2. If empty or "none" → **ready**.
3. If it references issue numbers (e.g., `#42, #45`), check if those issues are closed:

   ```bash
   gh issue view <NUMBER> --repo getlarge/themoltnet --json state -q '.state'
   ```

   - All closed → **ready**
   - Some open but assigned → **soon** (waiting on active work)
   - Some open and unassigned → **blocked**

4. Check for **file boundary overlaps**: read the issue body's Context Files section. If two ready tasks mention the same directory, flag as a potential conflict.

### Output Format

```
## Task Analysis

### Board Summary
- Todo: <N> | In Progress: <N> | Done: <N>

### Ready (can start now)
- **<Task Name>** #<N> [<Priority>] [<Effort>]
  Dependencies: none (or all satisfied)
  Context: <files from issue body>

### Soon (waiting on active work)
- **<Task Name>** #<N> [<Priority>] — waiting on: #<dep issue(s)>

### Blocked (dependencies not started)
- **<Task Name>** #<N> [<Priority>] — needs: #<dep issue(s)>

### Potential Conflicts
- <Task A> and <Task B> both touch <directory> — consider sequencing
```

---

## Action 2: Plan

**Triggers**: "distribute work", "plan tasks", "plan the wave", "what should I spawn?".

Prerequisite: Run the Analyze action first (internally) if you haven't already.

Present a **wave-based distribution plan**:

### Wave Planning Logic

1. Take all **ready** tasks from the analysis.
2. Remove any with file boundary conflicts (move the conflicting one to wave 2).
3. Sort remaining by priority: high > medium > low.
4. Present as Wave 1.
5. For **soon** tasks, estimate they'll become ready after Wave 1 completes. Present as Wave 2 candidates.
6. Note any **blocked** tasks that need manual intervention.

### Output Format

```
## Distribution Plan

### Wave 1 (parallel — start now)
| # | Task | Priority | Worktree Name | Branch |
|---|------|----------|---------------|--------|
| 1 | <name> | high | <repo>-<slug> | agent/<slug> |
| 2 | ... | | | |

### Wave 2 (after Wave 1 merges)
| # | Task | Unblocked By |
|---|------|-------------|
| 1 | <name> | <wave 1 task(s)> |

### Needs Attention
- <any blocked tasks or conflicts>

Ready to spawn? Say "spawn it" or "go ahead".
```

---

## Action 3: Spawn

**Triggers**: "spawn it", "go ahead", "create worktrees", "spawn" (after a plan has been presented).

For each task in the approved wave:

1. Derive a worktree slug from the task name: strip `WS\d+:\s*` prefix, lowercase, spaces to hyphens, keep only `[a-z0-9-]`. Examples:
   - "WS4: Auth library" -> `auth-library`
   - "WS3: Diary service" -> `diary-service`
   - "WS2: Ory token enrichment webhook" -> `ory-token-enrichment-webhook`

2. **Ask the user**: "Use Docker sandboxes for isolation? (Requires Docker Desktop 4.58+)" — two modes:

   **Mode A — Bare worktrees** (default):

   ```bash
   ./scripts/orchestrate.sh spawn <slug> main
   ```

   **Mode B — Docker sandbox** (stronger isolation):
   - For each task, tell the user: "Run `/sandbox-worktree <slug> main` to create a sandboxed worktree"
   - The `/sandbox-worktree` skill handles:
     - Creating the worktree via `orchestrate.sh spawn`
     - Copying `.sandbox-include` directories
     - Creating the Docker sandbox
     - Error handling and fallback
   - Do NOT attempt to run Docker sandbox commands yourself — delegate to the skill

3. Report results. If any spawn fails (worktree already exists), report the error and suggest `teardown` first.

4. After all spawns, run:

   ```bash
   ./scripts/orchestrate.sh list
   ```

   And if sandboxes were requested, run:

   ```bash
   docker sandbox ls 2>/dev/null
   ```

   to confirm everything is ready.

5. **CRITICAL - Auth Fix for Docker Sandboxes**: If Mode B was used, tell the user they must fix credential persistence BEFORE launching agents:

   **Correct workflow:**

   a. Launch ONE sandbox: `docker sandbox run themoltnet-<any-name>`
   b. Inside that sandbox: `claude login` (authenticate once)
   c. Exit the sandbox
   d. Run this batch fix for ALL sandboxes:

   ```bash
   docker sandbox ls | tail -n +2 | awk '{print $1}' | while read SANDBOX_NAME; do
     echo "Fixing credentials for: $SANDBOX_NAME"
     docker sandbox exec $SANDBOX_NAME bash -c '
       # CRITICAL: Remove apiKeyHelper that overrides OAuth tokens
       if [ -f /home/agent/.claude/settings.json ]; then
         cat /home/agent/.claude/settings.json | jq "del(.apiKeyHelper)" > /tmp/settings.json && \
           mv /tmp/settings.json /home/agent/.claude/settings.json
         echo "✓ Removed apiKeyHelper from settings"
       fi

       # Persist credentials to persistent volume
       sudo mkdir -p /mnt/claude-data
       sudo chown -R agent:agent /mnt/claude-data

       if [ -f /home/agent/.claude/.credentials.json ]; then
         cp /home/agent/.claude/.credentials.json /mnt/claude-data/
         cp /home/agent/.claude.json /mnt/claude-data/ 2>/dev/null || true
         rm /home/agent/.claude/.credentials.json
         rm /home/agent/.claude.json 2>/dev/null || true
         ln -s /mnt/claude-data/.credentials.json /home/agent/.claude/.credentials.json
         ln -s /mnt/claude-data/.claude.json /home/agent/.claude.json 2>/dev/null || true
         echo "✓ Credentials persisted to volume"
       else
         echo "⚠ No credentials found"
       fi
     ' 2>/dev/null || echo "  → Sandbox stopped or error"
   done
   ```

   e. Now all sandboxes are authenticated and will stay authenticated across restarts

   **Why this order?** Credentials must exist BEFORE they can be persisted. One `claude login` creates the credential file, then the batch script copies it to all sandboxes' persistent Docker volumes.

---

## Action 4: Launch

**Triggers**: "launch agents", "generate prompts", "give me the commands" (after spawn).

For each spawned task, generate a self-contained agent prompt and present it as a ready-to-run terminal command.

### Prompt Generation

For each task, build a prompt from the project board item and its linked issue:

```
You are an agent working on MoltNet. Your task: <Task Name>.

## Setup
1. Run /sync to check the coordination state
2. Run /claim <Task Name> to claim your task

## Context
Read these files first:
<list from Context Files column, one per line with "- " prefix>

Also read:
- CLAUDE.md (project conventions)
- docs/FREEDOM_PLAN.md (relevant workstream section)

## Task
<Notes column content>

## Workflow
1. Implement the task following project conventions in CLAUDE.md
2. Write tests (Vitest, AAA pattern)
3. Run: pnpm run validate
4. Fix any lint, typecheck, or test failures
5. Run /handoff to create journal entry and PR
```

### Output Formats

Ask the user which format they prefer, then generate:

**Option A — Individual commands** (copy-paste one at a time):

```bash
# Task: <name>
cd <worktree-path> && claude -p '<prompt>'
```

**Option B — tmux script** (all agents in one session):

```bash
tmux new-session -d -s agents
tmux send-keys -t agents:0 'cd <worktree-1> && claude -p "<prompt-1>"' C-m
tmux split-window -h -t agents
tmux send-keys -t agents:1 'cd <worktree-2> && claude -p "<prompt-2>"' C-m
# ... for each task
tmux attach -t agents
```

**Option C — Background with logs** (fire and forget):

```bash
cd <worktree-1> && claude -p '<prompt-1>' > agent-<slug-1>.log 2>&1 &
cd <worktree-2> && claude -p '<prompt-2>' > agent-<slug-2>.log 2>&1 &
# ... for each task
echo "Agents launched. Tail logs with:"
echo "  tail -f agent-*.log"
```

**Option D — Docker sandboxes** (if spawned with sandbox mode):

```bash
# Each agent runs inside its sandbox
docker sandbox run themoltnet-<slug-1>
# (in another terminal)
docker sandbox run themoltnet-<slug-2>
```

Note: Docker sandbox sessions are interactive — each needs its own terminal. Provide the commands as a list for the user to run manually.

Escape single quotes in prompts by replacing `'` with `'\''`.

---

## Action 5: Monitor

**Triggers**: "status", "check agents", "how are they doing?", "monitor".

Gather and present:

1. **Worktree status**:

   ```bash
   ./scripts/orchestrate.sh list
   ```

2. **Docker sandbox status** (if any exist):
   - Run `/sandbox-manager` to get sandbox status (delegates to the sandbox-manager skill)

3. **Branch activity** (for each agent branch):

   ```bash
   git fetch --all --quiet
   ```

   Then for each worktree that matches `agent/*`:

   ```bash
   git log --oneline -5 <branch>
   ```

4. **Open PRs and CI**:

   ```bash
   gh pr list --limit 10
   gh run list --limit 10
   ```

5. **Stale branch detection**:

   ```bash
   git branch -r --merged origin/main
   ```

   Flag any `agent/*` or `claude/*` remote branches that are fully merged into main — these are leftover from previous waves and can be deleted.

6. **Project board state**: query the board and summarize Todo vs In Progress vs Done.

### Output Format

```
## Agent Status

### Active Worktrees
| Worktree | Branch | Sandbox | Last Commit | Age |
|----------|--------|---------|-------------|-----|
| ...-auth-library | agent/auth-library | yes/no | <msg> | <time> |

### Open PRs
| PR | Title | Status | CI |
|----|-------|--------|----|
| #N | ... | review/draft | pass/fail/running |

### Stale Branches
- <branch> (merged, safe to delete)

### Task Board
- Active: <count> tasks in progress
- Available: <count> tasks remaining
- Completed: <count> tasks done
```

---

## Action 6: Cleanup

**Triggers**: "clean up", "next wave", "teardown", "merge and continue".

Guide the orchestrator through the end-of-wave lifecycle:

1. **Check mergeable PRs**:

   ```bash
   gh pr list --json number,title,mergeable,reviewDecision,statusCheckRollup --limit 20
   ```

   For each PR that has passing CI, present it for merge approval.

2. **Merge approved PRs** (only after explicit user confirmation for each):

   ```bash
   gh pr merge <number> --squash --delete-branch
   ```

3. **Teardown merged worktrees and sandboxes**:

   For each merged task's slug, tell the user to run `/sandbox-manager` to clean up both the sandbox and worktree. The sandbox-manager skill handles:
   - Removing the Docker sandbox (if it exists)
   - Removing the git worktree
   - Proper error handling

   Alternatively, for bare worktrees without sandboxes:

   ```bash
   ./scripts/orchestrate.sh teardown <slug>
   ```

4. **Delete stale remote branches**:

   ```bash
   git fetch --prune origin
   ```

   Then list any `agent/*` or `claude/*` remote branches with `ahead=0` relative to main. Present them to the user for batch deletion:

   ```bash
   gh api -X DELETE "repos/<owner>/<repo>/git/refs/heads/<branch>"
   ```

5. **Prune dangling worktree references**:

   ```bash
   git worktree prune
   ```

6. **Update local main**:

   ```bash
   git fetch origin main && git rebase origin/main
   ```

7. **Re-analyze**: Run the Analyze action to show what's now ready for the next wave.

### Output

After cleanup, show:

```
## Wave Complete

### Merged
- PR #N: <title>

### Cleaned Up
- Worktree: <slug> (removed)
- Sandbox: <slug> (removed) — if applicable

### Branches Deleted
- <branch> (was merged)

### Next Wave
<output from Analyze action>
```

---

## Important Notes

- **Never auto-merge PRs**. Always list them and wait for explicit user approval per PR.
- **Never auto-spawn without a plan**. Always show the plan first and wait for confirmation.
- Worktree slugs must match what `orchestrate.sh` expects: lowercase alphanumeric with hyphens.
- The repo name for worktree paths is derived from the repo root directory name (currently `themoltnet`).
- Agent prompts should be self-contained — the agent starts fresh with no prior context.
- When running shell commands, use absolute or repo-relative paths. The orchestrate script is at `scripts/orchestrate.sh`.
- **GitHub Projects is required**. If `gh` is not available or `MOLTNET_PROJECT_NUMBER` is not set, tell the user to set up the project board first (`./scripts/setup-project.sh`).
