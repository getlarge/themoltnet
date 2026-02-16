---
description: Claim a task from the project board. The user will specify which task to claim as: $ARGUMENTS
argument-hint: "[issue-number-or-name]"
---

Claim a task from the project board. The user will specify which task to claim as: $ARGUMENTS

The argument can be an issue number (e.g., `42`) or a task name substring.

## GitHub Projects Mode (primary)

If `gh` CLI is available and `MOLTNET_PROJECT_NUMBER` is set:

1. **Find the task** on the project board:

   ```bash
   gh project item-list "${MOLTNET_PROJECT_NUMBER}" --owner "${MOLTNET_PROJECT_OWNER:-getlarge}" --format json
   ```

   Search items for matching issue number or title substring.

2. **Validate readiness**:
   - The item's Status must be "Todo" (not "In Progress", "In Review", "Done", etc.)
   - Warn if Readiness is not "Ready for Agent" — the task may not be well-specified
   - Check the Dependencies text field — if it references issue numbers, verify those issues are closed

3. **Claim the task** by assigning the issue and tagging the Agent field:

   Assign the issue — this triggers the `project-automation.yml` GitHub Actions workflow which automatically moves Status to "In Progress":

   ```bash
   gh issue edit <NUMBER> --add-assignee "@me"
   ```

   Update the Agent field with a session identifier so other agents know who claimed it:

   ```bash
   PROJECT_ID=$(gh project view "${MOLTNET_PROJECT_NUMBER}" --owner "${MOLTNET_PROJECT_OWNER:-getlarge}" --format json | jq -r '.id')
   FIELDS=$(gh project field-list "${MOLTNET_PROJECT_NUMBER}" --owner "${MOLTNET_PROJECT_OWNER:-getlarge}" --format json)
   AGENT_FIELD_ID=$(echo "$FIELDS" | jq -r '.fields[] | select(.name == "Agent") | .id')
   AGENT_ID="$(whoami)-$(date +%s)"
   gh project item-edit --id "$ITEM_ID" --project-id "$PROJECT_ID" --field-id "$AGENT_FIELD_ID" --text "$AGENT_ID"
   ```

4. **Confirm the claim** and summarize:
   - Task title and issue number
   - Priority and effort fields
   - Context files (from issue body)
   - Dependencies status
   - What to do next

5. **Write the signal file** (`.agent-claim.json` in the project root) to enable hook-driven lifecycle:

   Write the JSON using the actual values from steps above (do NOT use a heredoc with literal placeholders):

   ```json
   {
     "schema_version": 1,
     "item_id": "<the ITEM_ID from step 3>",
     "issue_number": <the issue number>,
     "branch": "claude/<the branch you created>",
     "agent_id": "<the AGENT_ID from step 3>",
     "phase": "coding",
     "summary": "",
     "status": "In Progress",
     "pr_number": null,
     "last_check_poll": null,
     "last_synced_status": "In Progress"
   }
   ```

   The `branch` should match the branch you create for this task. The `summary` will be filled in during `/handoff`.

   **Important**: The signal file drives the post-coding lifecycle. The `phase` field controls what the hooks do:
   - `coding` — normal development, hooks sync status to board
   - `ready_for_pr` — on-stop hook creates the PR automatically
   - `pr_created` — on-idle hook polls CI checks
   - `done` — on-stop hook closes the issue and cleans up

## When GitHub Projects is Unavailable

If `gh` CLI is not available or `MOLTNET_PROJECT_NUMBER` is not set, tell the user:
"GitHub Projects access is required for task coordination. Ensure `gh` CLI is installed, authenticated with project scope (`gh auth refresh -s project`), and `MOLTNET_PROJECT_NUMBER` is set in `env.public`."
