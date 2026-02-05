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

**IMPORTANT**: The TASKS.md fallback only works on the **host**, not in Docker sandboxes (git operations required).

If you're in a sandbox and `gh` is unavailable, tell the user: "I'm running in a sandbox without GitHub Projects access. Please claim the task from the host using `/claim <task-name>`, then I can start work."

1. Read `TASKS.md` from the repo root
2. Find the specified task in the "Available" section
3. If the task is not in Available, report an error (it may already be claimed or not exist)
4. Check the task's dependencies — if any are not in the "Completed" section, warn that this task is blocked
5. Move the task from "Available" to "Active" with:
   - Agent: your session identifier or model name
   - Branch: the current git branch name
   - Status: `in-progress`
   - Started: today's date
6. Commit the change: `git add TASKS.md && git commit -m "tasks: claim <task-name>"`
7. Push: `git push origin HEAD`
8. Confirm the claim and summarize what you need to do

If the push fails because another agent claimed the same task:

1. Pull the latest TASKS.md: `git pull --rebase`
2. Check if your task is still available
3. If not, pick a different available task and ask the user
