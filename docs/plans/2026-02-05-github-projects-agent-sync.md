# GitHub Projects Agent Sync — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace TASKS.md with GitHub Projects v2 as the coordination layer, using Claude Code hooks to automatically sync agent work status and enable autonomous task pickup.

**Architecture:** Three-component system — (1) `scripts/agent-sync.sh` polls GitHub Projects via `gh project` CLI, (2) Claude Code hooks fire on session lifecycle events to inject project state as context, (3) GitHub Actions workflow validates issue quality and labels them ready for agents. The `/sync`, `/claim`, `/handoff` slash commands are updated to read/write GitHub Projects instead of TASKS.md.

**Tech Stack:** GitHub Projects v2 API (`gh project` CLI + GraphQL), Claude Code hooks (command type), GitHub Actions (`anthropics/claude-code-action@v1`), bash/jq.

**Related:** Issue #50, `docs/AGENT_COORDINATION.md`, `.claude/commands/`, `scripts/orchestrate.sh`

---

## Prerequisites

Before starting implementation:

1. Create a GitHub Project on the `getlarge/themoltnet` repo (manually or via `gh project create`)
2. Ensure the `gh` CLI token has the `project` scope: `gh auth refresh -s project`
3. Note the project number (e.g., `1`) — this becomes `MOLTNET_PROJECT_NUMBER`

The project owner is assumed to be `getlarge` (the GitHub org/user). The project number is configured via env var so it's not hardcoded.

---

## Task 1: Create the GitHub Project with Custom Fields

This is a manual/scripted setup step that creates the project board and all custom fields.

**Files:**

- Create: `scripts/setup-project.sh`

**Step 1: Write the project setup script**

```bash
#!/usr/bin/env bash
set -euo pipefail

# Setup script for MoltNet GitHub Project board
# Run once to create the project and all custom fields.
# Requires: gh CLI with `project` scope (run `gh auth refresh -s project`)
#
# Usage: ./scripts/setup-project.sh [--owner OWNER]

OWNER="${1:-getlarge}"
REPO="themoltnet"

echo "Creating GitHub Project for ${OWNER}/${REPO}..."

# Create the project
PROJECT_URL=$(gh project create --owner "$OWNER" --title "MoltNet Agent Board" --format url 2>/dev/null || true)
if [ -z "$PROJECT_URL" ]; then
  echo "Project may already exist. Listing projects..."
  gh project list --owner "$OWNER" --format json | jq '.projects[] | {number, title, url}'
  echo ""
  echo "Set MOLTNET_PROJECT_NUMBER to the project number and re-run if needed."
  exit 0
fi

# Extract project number from URL (last segment)
PROJECT_NUMBER=$(echo "$PROJECT_URL" | grep -oP '\d+$')
echo "Created project #${PROJECT_NUMBER}: ${PROJECT_URL}"

# Create custom fields
echo "Creating custom fields..."

gh project field-create "$PROJECT_NUMBER" --owner "$OWNER" \
  --name "Priority" --data-type "SINGLE_SELECT" \
  --single-select-options "P0: Critical,P1: High,P2: Medium,P3: Low"

gh project field-create "$PROJECT_NUMBER" --owner "$OWNER" \
  --name "Readiness" --data-type "SINGLE_SELECT" \
  --single-select-options "Draft,Needs Spec,Ready for Agent"

gh project field-create "$PROJECT_NUMBER" --owner "$OWNER" \
  --name "Effort" --data-type "SINGLE_SELECT" \
  --single-select-options "XS,S,M,L,XL"

gh project field-create "$PROJECT_NUMBER" --owner "$OWNER" \
  --name "Workstream" --data-type "SINGLE_SELECT" \
  --single-select-options "WS1,WS2,WS3,WS4,WS5,WS6,WS7,WS8,WS9,WS10,WS11"

gh project field-create "$PROJECT_NUMBER" --owner "$OWNER" \
  --name "Agent" --data-type "TEXT"

gh project field-create "$PROJECT_NUMBER" --owner "$OWNER" \
  --name "Dependencies" --data-type "TEXT"

echo ""
echo "Done. Project #${PROJECT_NUMBER} is ready."
echo "Add to your .env.public:"
echo "  MOLTNET_PROJECT_NUMBER=${PROJECT_NUMBER}"
echo "  MOLTNET_PROJECT_OWNER=${OWNER}"
```

**Step 2: Run the script to verify it parses correctly (dry run)**

Run: `bash -n scripts/setup-project.sh`
Expected: No syntax errors.

**Step 3: Commit**

```bash
git add scripts/setup-project.sh
git commit -m "feat: add GitHub Project setup script with custom fields"
```

---

## Task 2: Write the `agent-sync.sh` Polling Script

The core script that hooks call. It polls GitHub Projects state and returns JSON that hooks can inject as context.

**Files:**

- Create: `scripts/agent-sync.sh`

**Step 1: Write the agent-sync script**

```bash
#!/usr/bin/env bash
set -euo pipefail

# Agent Sync — Polls GitHub Projects and returns context for Claude Code hooks.
#
# Called by Claude Code hooks (SessionStart, Stop, Notification).
# Reads JSON from stdin (hook context), writes JSON to stdout.
#
# Usage:
#   echo '{}' | ./scripts/agent-sync.sh session-start
#   echo '{}' | ./scripts/agent-sync.sh on-stop
#   echo '{"notification_type":"idle_prompt"}' | ./scripts/agent-sync.sh on-idle
#
# Environment:
#   MOLTNET_PROJECT_NUMBER  — GitHub Project number (required)
#   MOLTNET_PROJECT_OWNER   — GitHub org/user (default: getlarge)

ACTION="${1:?Usage: agent-sync.sh <session-start|on-stop|on-idle>}"

PROJECT_NUMBER="${MOLTNET_PROJECT_NUMBER:-}"
PROJECT_OWNER="${MOLTNET_PROJECT_OWNER:-getlarge}"

# Read hook input from stdin (Claude Code sends JSON context)
HOOK_INPUT=$(cat)

# Bail early if gh is not available or project not configured
if ! command -v gh &>/dev/null; then
  echo '{"additionalContext": "GitHub CLI not available. Skipping project sync."}'
  exit 0
fi

if [ -z "$PROJECT_NUMBER" ]; then
  echo '{"additionalContext": "MOLTNET_PROJECT_NUMBER not set. Skipping project sync."}'
  exit 0
fi

# Ensure project scope is available (fail gracefully)
if ! gh project view "$PROJECT_NUMBER" --owner "$PROJECT_OWNER" --format json &>/dev/null; then
  echo '{"additionalContext": "Cannot access project #'"$PROJECT_NUMBER"'. Check gh auth (needs project scope)."}'
  exit 0
fi

# --- Helper: fetch all project items as JSON ---
fetch_items() {
  gh project item-list "$PROJECT_NUMBER" \
    --owner "$PROJECT_OWNER" \
    --format json 2>/dev/null || echo '{"items":[]}'
}

# --- Helper: get field IDs and option IDs ---
fetch_fields() {
  gh project field-list "$PROJECT_NUMBER" \
    --owner "$PROJECT_OWNER" \
    --format json 2>/dev/null || echo '{"fields":[]}'
}

# --- Helper: update a single-select field on an item ---
update_item_field() {
  local item_id="$1"
  local field_name="$2"
  local option_name="$3"

  local project_id
  project_id=$(gh project view "$PROJECT_NUMBER" --owner "$PROJECT_OWNER" --format json | jq -r '.id')

  local fields
  fields=$(fetch_fields)

  local field_id
  field_id=$(echo "$fields" | jq -r --arg name "$field_name" '.fields[] | select(.name == $name) | .id')

  local option_id
  option_id=$(echo "$fields" | jq -r --arg name "$field_name" --arg opt "$option_name" \
    '.fields[] | select(.name == $name) | .options[] | select(.name == $opt) | .id')

  if [ -n "$field_id" ] && [ -n "$option_id" ]; then
    gh project item-edit \
      --id "$item_id" \
      --project-id "$project_id" \
      --field-id "$field_id" \
      --single-select-option-id "$option_id" 2>/dev/null
  fi
}

# --- Helper: update a text field on an item ---
update_item_text() {
  local item_id="$1"
  local field_name="$2"
  local value="$3"

  local project_id
  project_id=$(gh project view "$PROJECT_NUMBER" --owner "$PROJECT_OWNER" --format json | jq -r '.id')

  local fields
  fields=$(fetch_fields)

  local field_id
  field_id=$(echo "$fields" | jq -r --arg name "$field_name" '.fields[] | select(.name == $name) | .id')

  if [ -n "$field_id" ]; then
    gh project item-edit \
      --id "$item_id" \
      --project-id "$project_id" \
      --field-id "$field_id" \
      --text "$value" 2>/dev/null
  fi
}

# ============================================================
# Actions
# ============================================================

case "$ACTION" in

  session-start)
    # Pull project state and inject as context for the agent.
    ITEMS=$(fetch_items)

    READY_COUNT=$(echo "$ITEMS" | jq '[.items[] | select(.status == "Ready")] | length')
    IN_PROGRESS_COUNT=$(echo "$ITEMS" | jq '[.items[] | select(.status == "In Progress")] | length')
    DONE_COUNT=$(echo "$ITEMS" | jq '[.items[] | select(.status == "Done")] | length')

    READY_LIST=$(echo "$ITEMS" | jq -r '[.items[] | select(.status == "Ready")] | .[0:5] | .[] | "- \(.title) (#\(.content.number // "?"))"' 2>/dev/null || echo "- none")

    IN_PROGRESS_LIST=$(echo "$ITEMS" | jq -r '[.items[] | select(.status == "In Progress")] | .[] | "- \(.title) (agent: \(.agent // "unassigned"))"' 2>/dev/null || echo "- none")

    CONTEXT="GitHub Project Board (#${PROJECT_NUMBER}):
Ready: ${READY_COUNT} items | In Progress: ${IN_PROGRESS_COUNT} | Done: ${DONE_COUNT}

Available tasks (Ready for Agent):
${READY_LIST}

Currently in progress:
${IN_PROGRESS_LIST}

Use /claim <issue-number> to claim a task. Use /sync for full board state."

    # Escape for JSON
    CONTEXT_JSON=$(echo "$CONTEXT" | jq -Rs .)
    echo "{\"additionalContext\": ${CONTEXT_JSON}}"
    ;;

  on-stop)
    # After each Claude response, check if the agent signaled a status change.
    # Convention: agent writes .agent-claim.json with {item_id, status, agent_id}
    CLAIM_FILE="${CLAUDE_PROJECT_DIR:-.}/.agent-claim.json"

    if [ -f "$CLAIM_FILE" ]; then
      ITEM_ID=$(jq -r '.item_id' "$CLAIM_FILE")
      NEW_STATUS=$(jq -r '.status // empty' "$CLAIM_FILE")
      AGENT_ID=$(jq -r '.agent_id // "unknown"' "$CLAIM_FILE")

      if [ -n "$ITEM_ID" ] && [ -n "$NEW_STATUS" ]; then
        update_item_field "$ITEM_ID" "Status" "$NEW_STATUS"
        update_item_text "$ITEM_ID" "Agent" "$AGENT_ID"
      fi

      rm -f "$CLAIM_FILE"
    fi

    exit 0
    ;;

  on-idle)
    # When agent is idle (waiting for input), check if current work was merged
    # and surface next available task.
    BRANCH=$(git branch --show-current 2>/dev/null || echo "")

    if [ -z "$BRANCH" ]; then
      exit 0
    fi

    # Check if current branch has a PR and its state
    PR_STATE=$(gh pr view "$BRANCH" --json state -q '.state' 2>/dev/null || echo "UNKNOWN")

    if [ "$PR_STATE" = "MERGED" ]; then
      ITEMS=$(fetch_items)
      NEXT=$(echo "$ITEMS" | jq -r '[.items[] | select(.status == "Ready")] | sort_by(.priority // "Z") | .[0] | "\(.title) (#\(.content.number // "?"))"' 2>/dev/null || echo "none")

      if [ "$NEXT" != "none" ] && [ "$NEXT" != "null" ]; then
        CONTEXT="Your PR on branch ${BRANCH} was merged! Next available task: ${NEXT}. Use /claim to pick it up."
        CONTEXT_JSON=$(echo "$CONTEXT" | jq -Rs .)
        echo "{\"additionalContext\": ${CONTEXT_JSON}}"
      fi
    fi
    ;;

  *)
    echo '{"error": "Unknown action: '"$ACTION"'"}' >&2
    exit 1
    ;;
esac
```

**Step 2: Verify syntax**

Run: `bash -n scripts/agent-sync.sh`
Expected: No syntax errors.

**Step 3: Commit**

```bash
git add scripts/agent-sync.sh
git commit -m "feat: add agent-sync script for GitHub Projects polling"
```

---

## Task 3: Configure Claude Code Hooks

Wire `agent-sync.sh` into the Claude Code session lifecycle via hooks in the project settings file.

**Files:**

- Modify: `.claude/settings.json`

**Step 1: Read current settings**

The current `.claude/settings.json` only has `enabledPlugins`. We need to add a `hooks` key.

**Step 2: Add hooks configuration**

Update `.claude/settings.json` to:

```json
{
  "enabledPlugins": {
    "code-review@claude-plugins-official": true,
    "feature-dev@claude-plugins-official": true,
    "typescript-lsp@claude-plugins-official": true,
    "frontend-design@claude-plugins-official": true,
    "pr-review-toolkit@claude-plugins-official": true,
    "claude-md-management@claude-plugins-official": true,
    "feature-dev@claude-code-plugins": true,
    "superpowers@claude-plugins-official": true
  },
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/scripts/agent-sync.sh session-start",
            "timeout": 30000
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/scripts/agent-sync.sh on-stop",
            "timeout": 15000,
            "async": true
          }
        ]
      }
    ],
    "Notification": [
      {
        "matcher": "idle_prompt",
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/scripts/agent-sync.sh on-idle",
            "timeout": 30000
          }
        ]
      }
    ]
  }
}
```

**Step 3: Commit**

```bash
git add .claude/settings.json
git commit -m "feat: add Claude Code hooks for GitHub Projects sync"
```

---

## Task 4: Update `/sync` Command for GitHub Projects

Replace the TASKS.md-based sync with GitHub Projects polling. Falls back to TASKS.md if `gh` or project is unavailable.

**Files:**

- Modify: `.claude/commands/sync.md`

**Step 1: Rewrite sync.md**

````markdown
Check the current coordination state before starting work. Do the following:

1. **Check GitHub Project board** (primary source):

   First check if `gh` CLI is available and MOLTNET_PROJECT_NUMBER is set.
   If both are available:

   ```bash
   gh project item-list "${MOLTNET_PROJECT_NUMBER}" --owner "${MOLTNET_PROJECT_OWNER:-getlarge}" --format json
   ```
````

Parse the JSON and report:

- Items with Status "Ready" — tasks available to claim
- Items with Status "In Progress" — what other agents are working on
- Items with Status "Done" recently — what was just completed
- Items with Readiness "Ready for Agent" — validated and ready to pick up

If `gh` or the project is unavailable, fall back to reading `TASKS.md`.

2. **Fall back to TASKS.md** (if GitHub Projects unavailable):

   Read `TASKS.md` in the repo root. Report:
   - Which tasks are Active (in-progress by other agents)
   - Which tasks are Available (you could claim one)
   - Which tasks are Completed recently

3. **Check open pull requests**:

   ```bash
   gh pr list --limit 10 --json number,title,headRefName,state,statusCheckRollup
   ```

   Report what PRs are open and their CI status.

4. **Check recent CI runs**:

   ```bash
   gh run list --limit 5 --json conclusion,headBranch,name,startedAt
   ```

   Report if main is green or broken.

5. **Check recent commits on main**:

   ```bash
   gh api repos/:owner/:repo/commits?sha=main --jq '.[0:5] | .[] | "\(.sha[0:7]) \(.commit.message | split("\n")[0])"'
   ```

6. **Read the most recent handoff** entry in `docs/journal/` to understand what the last agent did.

7. **Summarize**:
   - Project board state (ready / in-progress / done counts)
   - What other agents are working on
   - What's available for you
   - Recent main branch activity
   - Any blockers or conflicts to be aware of

**Note**: This command works in both host and sandbox environments. If in a sandbox, it uses `gh` CLI exclusively (no git commands) since git operations don't work in Docker sandboxes. If neither `gh` nor `TASKS.md` is available, report that and suggest the user set up the project board.

````

**Step 2: Commit**

```bash
git add .claude/commands/sync.md
git commit -m "feat: update /sync to use GitHub Projects as primary source"
````

---

## Task 5: Update `/claim` Command for GitHub Projects

Replace TASKS.md manipulation with GitHub Projects field updates.

**Files:**

- Modify: `.claude/commands/claim.md`

**Step 1: Rewrite claim.md**

````markdown
Claim a task from the project board. The user will specify which task to claim as: $ARGUMENTS

The argument can be an issue number (e.g., `42`) or a task name substring.

## GitHub Projects Mode (primary)

If `gh` CLI is available and `MOLTNET_PROJECT_NUMBER` is set:

1. **Find the task** on the project board:

   ```bash
   gh project item-list "${MOLTNET_PROJECT_NUMBER}" --owner "${MOLTNET_PROJECT_OWNER:-getlarge}" --format json
   ```
````

Search items for matching issue number or title substring.

2. **Validate readiness**:
   - The item's Status must be "Ready" (not "In Progress", "Done", etc.)
   - Warn if Readiness is not "Ready for Agent" — the task may not be well-specified
   - Check the Dependencies text field — if it references issue numbers, verify those issues are closed

3. **Claim the task** by updating project fields:

   Get the project ID and field IDs:

   ```bash
   PROJECT_ID=$(gh project view "${MOLTNET_PROJECT_NUMBER}" --owner "${MOLTNET_PROJECT_OWNER:-getlarge}" --format json | jq -r '.id')
   FIELDS=$(gh project field-list "${MOLTNET_PROJECT_NUMBER}" --owner "${MOLTNET_PROJECT_OWNER:-getlarge}" --format json)
   ```

   Update Status to "In Progress":

   ```bash
   STATUS_FIELD_ID=$(echo "$FIELDS" | jq -r '.fields[] | select(.name == "Status") | .id')
   IN_PROGRESS_ID=$(echo "$FIELDS" | jq -r '.fields[] | select(.name == "Status") | .options[] | select(.name == "In Progress") | .id')
   gh project item-edit --id "$ITEM_ID" --project-id "$PROJECT_ID" --field-id "$STATUS_FIELD_ID" --single-select-option-id "$IN_PROGRESS_ID"
   ```

   Update Agent field with session identifier:

   ```bash
   AGENT_FIELD_ID=$(echo "$FIELDS" | jq -r '.fields[] | select(.name == "Agent") | .id')
   gh project item-edit --id "$ITEM_ID" --project-id "$PROJECT_ID" --field-id "$AGENT_FIELD_ID" --text "$(whoami)-$(date +%s)"
   ```

4. **Assign the issue** (if it's a GitHub issue):

   ```bash
   gh issue edit <NUMBER> --add-assignee "@me"
   ```

5. **Confirm the claim** and summarize:
   - Task title and issue number
   - Priority and effort fields
   - Context files (from issue body)
   - Dependencies status
   - What to do next

## TASKS.md Fallback

If GitHub Projects is unavailable, fall back to the original TASKS.md workflow:

1. Read `TASKS.md` from the repo root
2. Find the specified task in the "Available" section
3. If the task is not in Available, report an error
4. Check dependencies — if any are not in "Completed", warn that this task is blocked
5. Move the task from "Available" to "Active" with current agent info
6. Commit: `git add TASKS.md && git commit -m "tasks: claim <task-name>"`
7. Push: `git push origin HEAD`

If the push fails (another agent claimed first):

1. Pull latest: `git pull --rebase`
2. Check if task is still available
3. If not, pick a different task

````

**Step 2: Commit**

```bash
git add .claude/commands/claim.md
git commit -m "feat: update /claim to use GitHub Projects with TASKS.md fallback"
````

---

## Task 6: Update `/handoff` Command for GitHub Projects

Update the handoff command to sync status back to the project board.

**Files:**

- Modify: `.claude/commands/handoff.md`

**Step 1: Rewrite handoff.md**

````markdown
End your session with a proper handoff. Do the following:

1. **Update task status on GitHub Projects** (if available):

   If `gh` CLI is available and `MOLTNET_PROJECT_NUMBER` is set, update the project board:

   ```bash
   # Get project and field info
   PROJECT_ID=$(gh project view "${MOLTNET_PROJECT_NUMBER}" --owner "${MOLTNET_PROJECT_OWNER:-getlarge}" --format json | jq -r '.id')
   FIELDS=$(gh project field-list "${MOLTNET_PROJECT_NUMBER}" --owner "${MOLTNET_PROJECT_OWNER:-getlarge}" --format json)
   ITEMS=$(gh project item-list "${MOLTNET_PROJECT_NUMBER}" --owner "${MOLTNET_PROJECT_OWNER:-getlarge}" --format json)
   ```
````

Find the item you were working on (match by issue number or by Agent field containing your identifier).

- If your task is **complete** (PR created): update Status to "In Review"
- If your task is **not complete**: keep Status as "In Progress", note progress in the Agent field

**Also update TASKS.md** for backward compatibility:

- If your task is complete: move it from "Active" to "Completed" with a PR link
- If your task is in progress: update the status description in Active

2. **Check landing page status**: If workstream progress changed, update `apps/landing/src/components/Status.tsx` (the `workstreams` array) and adjust the test in `apps/landing/__tests__/landing.test.tsx` to match.

3. **Write a journal handoff entry** in `docs/journal/` following the format in `docs/BUILDER_JOURNAL.md`:
   - What was done this session
   - What's not done yet
   - Current state (branch, test status, build status)
   - Decisions made
   - Open questions
   - Where to start next

4. **Update the journal index** in `docs/journal/README.md`

5. **Run validation**:

   ```bash
   pnpm run validate
   ```

   Report the results.

6. **Commit everything**:

   ```bash
   git add TASKS.md docs/journal/
   git commit -m "handoff: <brief description of what was accomplished>"
   ```

7. **Create a PR** if the work is ready for review:

   ```bash
   gh pr create --title "<task name>" --body "## Summary\n<what was done>\n\n## Task\nFrom project board: <task> (#<issue>)\n\n## Testing\n- [ ] All tests pass\n- [ ] New tests added"
   ```

   If the work is not ready, just push the branch.

8. **Report** the final state: PR URL (if created), branch name, test status, project board status, what the next agent should do.

````

**Step 2: Commit**

```bash
git add .claude/commands/handoff.md
git commit -m "feat: update /handoff to sync status back to GitHub Projects"
````

---

## Task 7: Create Issue Triage Workflow

A GitHub Actions workflow that validates issue quality and sets the Readiness field on the project board.

**Files:**

- Create: `.github/workflows/issue-triage.yml`

**Step 1: Write the triage workflow**

````yaml
name: Issue Triage

on:
  issues:
    types: [opened, edited, labeled]
  # Periodic sweep for issues that may have been updated
  # outside of the standard events (e.g., project field changes)
  schedule:
    - cron: '0 */6 * * *' # every 6 hours

permissions:
  contents: read
  issues: write
  pull-requests: read
  id-token: write

jobs:
  triage-single:
    # Runs on individual issue events
    if: github.event_name == 'issues'
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 1

      - name: Triage issue
        uses: anthropics/claude-code-action@v1
        with:
          claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          prompt: |
            You are the MoltNet issue triage agent. Review issue #${{ github.event.issue.number }}.

            Read the issue body and check these quality criteria:

            1. **Acceptance criteria**: The issue body contains a "Done when", "Acceptance criteria",
               or checklist section that defines what "done" looks like.
            2. **Context files**: The issue body references specific files or directories in the repo
               (paths like `libs/auth/`, `apps/rest-api/src/`, etc.).
            3. **Dependencies declared**: The issue body explicitly lists dependencies
               (e.g., "Depends on #42") or states "No dependencies".
            4. **Single responsibility**: The issue describes one coherent task, not multiple
               unrelated changes bundled together.
            5. **Scoped effort**: The work described is achievable in a single agent session
               (roughly 1-4 hours of work, not a multi-week epic).

            For each criterion, evaluate pass/fail with a brief explanation.

            Then take action based on the results:

            **If ALL 5 criteria pass:**
            - Add the label `ready-for-agent`
            - Comment: "Triage: This issue meets all quality criteria and is ready for agent pickup."
            - List which criteria passed

            **If ANY criteria fail:**
            - Add the label `needs-spec`
            - Remove the label `ready-for-agent` if present
            - Comment: "Triage: This issue needs more detail before an agent can work on it."
            - List which criteria failed and what's needed to fix each one

            Use these commands:
            ```bash
            gh issue edit ${{ github.event.issue.number }} --add-label "ready-for-agent"
            gh issue edit ${{ github.event.issue.number }} --add-label "needs-spec"
            gh issue edit ${{ github.event.issue.number }} --remove-label "ready-for-agent"
            gh issue comment ${{ github.event.issue.number }} --body "..."
            ```

          additional_permissions: |
            issues: write

  triage-sweep:
    # Periodic sweep: re-check all open issues without `ready-for-agent` label
    if: github.event_name == 'schedule'
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 1

      - name: Sweep unlabeled issues
        uses: anthropics/claude-code-action@v1
        with:
          claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          prompt: |
            You are the MoltNet issue triage agent running a periodic sweep.

            List all open issues that do NOT have the `ready-for-agent` label:
            ```bash
            gh issue list --state open --label "needs-spec" --limit 20 --json number,title
            ```

            For each issue, check if it has been updated since the last triage
            (look for recent edits or comments that may have addressed the feedback).

            If an issue now meets all 5 quality criteria (acceptance criteria, context files,
            dependencies declared, single responsibility, scoped effort):
            - Remove `needs-spec` label
            - Add `ready-for-agent` label
            - Comment noting it now passes triage

            Only check issues labeled `needs-spec`. Do not re-triage issues that already
            have `ready-for-agent`.

          additional_permissions: |
            issues: write
````

**Step 2: Verify YAML syntax**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/issue-triage.yml'))" 2>/dev/null || echo "install pyyaml or verify manually"`

**Step 3: Commit**

```bash
git add .github/workflows/issue-triage.yml
git commit -m "feat: add issue triage workflow for agent readiness validation"
```

---

## Task 8: Create GitHub Labels

Create the labels the triage workflow depends on.

**Files:**

- Create: `scripts/setup-labels.sh`

**Step 1: Write the label setup script**

```bash
#!/usr/bin/env bash
set -euo pipefail

# Create GitHub labels for agent coordination.
# Idempotent — safe to run multiple times.

REPO="${1:-getlarge/themoltnet}"

echo "Creating labels on ${REPO}..."

# Readiness labels
gh label create "ready-for-agent" --repo "$REPO" --color "0E8A16" --description "Issue is well-specified and ready for agent pickup" --force
gh label create "needs-spec" --repo "$REPO" --color "E4E669" --description "Issue needs more detail before agent can work on it" --force

# Priority labels
gh label create "priority:critical" --repo "$REPO" --color "B60205" --description "P0 — Drop everything" --force
gh label create "priority:high" --repo "$REPO" --color "D93F0B" --description "P1 — Do next" --force
gh label create "priority:medium" --repo "$REPO" --color "FBCA04" --description "P2 — Normal priority" --force
gh label create "priority:low" --repo "$REPO" --color "0075CA" --description "P3 — When time allows" --force

# Effort labels
gh label create "effort:xs" --repo "$REPO" --color "C5DEF5" --description "Extra small — < 30 min" --force
gh label create "effort:s" --repo "$REPO" --color "BFD4F2" --description "Small — 30 min to 1 hour" --force
gh label create "effort:m" --repo "$REPO" --color "A2C4E0" --description "Medium — 1-2 hours" --force
gh label create "effort:l" --repo "$REPO" --color "7BA7CC" --description "Large — 2-4 hours" --force
gh label create "effort:xl" --repo "$REPO" --color "5B8DB8" --description "Extra large — 4+ hours" --force

# Workstream labels
for ws in $(seq 1 11); do
  gh label create "ws${ws}" --repo "$REPO" --color "D4C5F9" --description "Workstream ${ws}" --force
done

# Agent coordination labels
gh label create "agent-task" --repo "$REPO" --color "1D76DB" --description "Task suitable for AI agent" --force
gh label create "in-progress" --repo "$REPO" --color "FEF2C0" --description "Currently being worked on by an agent" --force

echo "Done. Labels created on ${REPO}."
```

**Step 2: Verify syntax**

Run: `bash -n scripts/setup-labels.sh`
Expected: No syntax errors.

**Step 3: Commit**

```bash
git add scripts/setup-labels.sh
git commit -m "feat: add label setup script for agent coordination"
```

---

## Task 9: Create Issue Templates

Standardized issue templates that guide authors to include the information the triage agent checks.

**Files:**

- Create: `.github/ISSUE_TEMPLATE/agent-task.yml`

**Step 1: Write the issue template**

```yaml
name: Agent Task
description: Create a task that can be picked up by an AI agent
title: '[TASK] '
labels: ['agent-task']
body:
  - type: markdown
    attributes:
      value: |
        ## Agent Task Template
        Fill in the sections below so the triage agent can validate this task.
        Issues that pass all criteria get labeled `ready-for-agent` automatically.

  - type: textarea
    id: description
    attributes:
      label: Description
      description: What needs to be built or changed?
      placeholder: Describe the task clearly and concisely.
    validations:
      required: true

  - type: textarea
    id: acceptance-criteria
    attributes:
      label: Acceptance Criteria
      description: When is this task done? List specific, verifiable criteria.
      placeholder: |
        - [ ] Feature X works as described
        - [ ] Tests pass for new functionality
        - [ ] No regression in existing tests
    validations:
      required: true

  - type: textarea
    id: context-files
    attributes:
      label: Context Files
      description: Which files or directories should the agent read first?
      placeholder: |
        - `libs/auth/src/`
        - `docs/AUTH_FLOW.md`
        - `apps/rest-api/src/routes/`
    validations:
      required: true

  - type: textarea
    id: dependencies
    attributes:
      label: Dependencies
      description: Does this task depend on other issues being completed first?
      placeholder: |
        No dependencies
        OR
        Depends on #42, #45
    validations:
      required: true

  - type: dropdown
    id: workstream
    attributes:
      label: Workstream
      description: Which workstream does this belong to?
      options:
        - WS1 (Infrastructure)
        - WS2 (Ory Config)
        - WS3 (Database & Services)
        - WS4 (Auth Library)
        - WS5 (MCP Server)
        - WS6 (REST API)
        - WS7 (Deployment)
        - WS8 (OpenClawd Skill)
        - WS9 (Agent SDK)
        - WS10 (Mission Integrity)
        - WS11 (Human Participation)
        - Other
    validations:
      required: true

  - type: dropdown
    id: effort
    attributes:
      label: Estimated Effort
      options:
        - XS (< 30 min)
        - S (30 min - 1 hour)
        - M (1-2 hours)
        - L (2-4 hours)
        - XL (4+ hours)
    validations:
      required: true

  - type: dropdown
    id: priority
    attributes:
      label: Priority
      options:
        - P0 Critical
        - P1 High
        - P2 Medium
        - P3 Low
    validations:
      required: true
```

**Step 2: Commit**

```bash
git add .github/ISSUE_TEMPLATE/agent-task.yml
git commit -m "feat: add agent task issue template with triage-ready fields"
```

---

## Task 10: Update the Orchestrate Skill for GitHub Projects

Update the orchestrate skill to read from GitHub Projects as the primary source, keeping TASKS.md as fallback.

**Files:**

- Modify: `.claude/skills/orchestrate/SKILL.md`

**Step 1: Update the task sources section**

In the existing SKILL.md, the "Task Sources" section already mentions GitHub Issues as supplementary. Update it to make GitHub Projects the primary source and TASKS.md the fallback.

Replace the "Task Sources" paragraph and the "From TASKS.md" / "From GitHub Issues" subsections in Action 1 to prefer `gh project item-list` first.

Key changes:

- Action 1 (Analyze): Query `gh project item-list` first, fall back to TASKS.md + `gh issue list`
- Action 2 (Plan): When adding tasks to the board, use `gh project item-add` instead of editing TASKS.md
- Action 5 (Monitor): Include project board status alongside worktree/PR/CI checks
- Action 6 (Cleanup): After merging PRs, update project item status to "Done"

This is a large file — the specific edits depend on how much of the existing skill should be preserved vs replaced. The key principle is: **GitHub Projects is authoritative, TASKS.md is a read-only fallback**.

**Step 2: Commit**

```bash
git add .claude/skills/orchestrate/SKILL.md
git commit -m "feat: update orchestrate skill to use GitHub Projects as primary source"
```

---

## Task 11: Update Agent Coordination Docs

Update `docs/AGENT_COORDINATION.md` to document the new GitHub Projects workflow alongside the existing TASKS.md approach.

**Files:**

- Modify: `docs/AGENT_COORDINATION.md`

**Step 1: Add a new section after "Layer 2: Coordination with TASKS.md"**

Add a section "Layer 2b: Coordination with GitHub Projects" explaining:

- The project board fields and their meaning
- How hooks automate sync
- How `/claim` and `/handoff` work with the project board
- TASKS.md as fallback for environments without `gh`

**Step 2: Update the overview table**

Add GitHub Projects as the primary coordination mechanism:

```markdown
| Layer            | Mechanism                           | Purpose                                              |
| ---------------- | ----------------------------------- | ---------------------------------------------------- |
| **Isolation**    | Git worktrees                       | Each agent gets its own working directory and branch |
| **Coordination** | GitHub Projects (TASKS.md fallback) | Single source of truth for who's doing what          |
| **Awareness**    | PR monitoring + journal + hooks     | Agents check what others have shipped                |
| **Integration**  | PR-based merge + CI                 | Work merges through reviewed pull requests           |
```

**Step 3: Commit**

```bash
git add docs/AGENT_COORDINATION.md
git commit -m "docs: update agent coordination to document GitHub Projects workflow"
```

---

## Task 12: Add Environment Variables to `.env.public`

Add the project configuration variables that scripts reference.

**Files:**

- Modify: `.env.public`

**Step 1: Read current .env.public**

Check what's already there.

**Step 2: Append project config**

Add:

```
# GitHub Projects coordination
MOLTNET_PROJECT_NUMBER=
MOLTNET_PROJECT_OWNER=getlarge
```

The project number is left blank — it gets filled in after running `scripts/setup-project.sh`.

**Step 3: Commit**

```bash
git add .env.public
git commit -m "feat: add GitHub Projects env vars to .env.public"
```

---

## Task 13: Migrate Existing TASKS.md to Issues

A one-time migration script that creates GitHub issues from TASKS.md Available items and adds them to the project board.

**Files:**

- Create: `scripts/migrate-tasks-to-issues.sh`

**Step 1: Write the migration script**

```bash
#!/usr/bin/env bash
set -euo pipefail

# Migrate TASKS.md Available tasks to GitHub Issues and add to project board.
# Run once during migration. Idempotent — skips issues with matching titles.
#
# Usage: ./scripts/migrate-tasks-to-issues.sh [--dry-run]

DRY_RUN="${1:-}"
REPO="getlarge/themoltnet"
PROJECT_NUMBER="${MOLTNET_PROJECT_NUMBER:?Set MOLTNET_PROJECT_NUMBER first}"
PROJECT_OWNER="${MOLTNET_PROJECT_OWNER:-getlarge}"

echo "Migrating TASKS.md to GitHub Issues..."

# Parse Available section from TASKS.md
# Extract rows between ## Available and the next ## or EOF
awk '/^## Available/,/^## [A-Z]|^$/' TASKS.md | \
  grep '^|' | \
  grep -v '^| Task' | \
  grep -v '^| ---' | \
while IFS='|' read -r _ task priority deps context notes _; do
  # Trim whitespace
  task=$(echo "$task" | xargs)
  priority=$(echo "$priority" | xargs)
  deps=$(echo "$deps" | xargs)
  context=$(echo "$context" | xargs)
  notes=$(echo "$notes" | xargs)

  if [ -z "$task" ]; then continue; fi

  echo ""
  echo "Task: $task"
  echo "  Priority: $priority"
  echo "  Dependencies: $deps"
  echo "  Context: $context"

  # Check if issue already exists
  EXISTING=$(gh issue list --repo "$REPO" --search "\"$task\" in:title" --json number --jq '.[0].number' 2>/dev/null || echo "")
  if [ -n "$EXISTING" ]; then
    echo "  → Already exists as #${EXISTING}, skipping"
    continue
  fi

  if [ "$DRY_RUN" = "--dry-run" ]; then
    echo "  → [DRY RUN] Would create issue"
    continue
  fi

  # Create the issue
  BODY="## Description

${notes}

## Acceptance Criteria

- [ ] Implementation complete
- [ ] Tests pass
- [ ] Validation passes (\`pnpm run validate\`)

## Context Files

${context}

## Dependencies

${deps}

---
_Migrated from TASKS.md_"

  ISSUE_URL=$(gh issue create \
    --repo "$REPO" \
    --title "$task" \
    --body "$BODY" \
    --label "agent-task" 2>/dev/null || echo "FAILED")

  if [ "$ISSUE_URL" = "FAILED" ]; then
    echo "  → Failed to create issue"
    continue
  fi

  echo "  → Created: $ISSUE_URL"

  # Add to project board
  gh project item-add "$PROJECT_NUMBER" \
    --owner "$PROJECT_OWNER" \
    --url "$ISSUE_URL" 2>/dev/null || echo "  → Failed to add to project"
done

echo ""
echo "Migration complete."
echo "Next steps:"
echo "  1. Review created issues on GitHub"
echo "  2. Set Priority, Effort, Workstream fields on the project board"
echo "  3. Run triage (or wait for the workflow) to set Readiness"
```

**Step 2: Verify syntax**

Run: `bash -n scripts/migrate-tasks-to-issues.sh`
Expected: No syntax errors.

**Step 3: Commit**

```bash
git add scripts/migrate-tasks-to-issues.sh
git commit -m "feat: add TASKS.md to GitHub Issues migration script"
```

---

## Task 14: Final Integration Commit and Validation

Verify everything hangs together and passes lint/typecheck.

**Files:**

- None new — validation only

**Step 1: Make all scripts executable**

```bash
chmod +x scripts/setup-project.sh scripts/agent-sync.sh scripts/setup-labels.sh scripts/migrate-tasks-to-issues.sh
```

**Step 2: Run lint on markdown files**

```bash
pnpm run lint
```

Expected: Pass (or only pre-existing warnings).

**Step 3: Verify shell scripts have no syntax errors**

```bash
for f in scripts/setup-project.sh scripts/agent-sync.sh scripts/setup-labels.sh scripts/migrate-tasks-to-issues.sh; do
  bash -n "$f" && echo "OK: $f" || echo "FAIL: $f"
done
```

Expected: All OK.

**Step 4: Commit and push**

```bash
git add -A
git commit -m "chore: make scripts executable, final validation"
git push -u origin claude/github-projects-agent-sync-wexy8
```

---

## Summary

| Task | What                     | Files                                   |
| ---- | ------------------------ | --------------------------------------- |
| 1    | Project setup script     | `scripts/setup-project.sh`              |
| 2    | Agent sync script (core) | `scripts/agent-sync.sh`                 |
| 3    | Claude Code hooks        | `.claude/settings.json`                 |
| 4    | Update /sync command     | `.claude/commands/sync.md`              |
| 5    | Update /claim command    | `.claude/commands/claim.md`             |
| 6    | Update /handoff command  | `.claude/commands/handoff.md`           |
| 7    | Issue triage workflow    | `.github/workflows/issue-triage.yml`    |
| 8    | Label setup script       | `scripts/setup-labels.sh`               |
| 9    | Issue template           | `.github/ISSUE_TEMPLATE/agent-task.yml` |
| 10   | Update orchestrate skill | `.claude/skills/orchestrate/SKILL.md`   |
| 11   | Update coordination docs | `docs/AGENT_COORDINATION.md`            |
| 12   | Environment variables    | `.env.public`                           |
| 13   | Migration script         | `scripts/migrate-tasks-to-issues.sh`    |
| 14   | Final validation + push  | —                                       |

## Execution Order

Tasks 1-9 are independent and can be parallelized. Tasks 10-11 depend on understanding the pattern from earlier tasks. Task 12 is trivial. Task 13 depends on 1 and 8 being run first (labels and project exist). Task 14 is always last.
