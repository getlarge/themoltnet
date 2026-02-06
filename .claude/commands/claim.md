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
   - The item's Status must be "Todo" (not "In Progress", "Done", etc.)
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

## When GitHub Projects is Unavailable

If `gh` CLI is not available or `MOLTNET_PROJECT_NUMBER` is not set, tell the user:
"GitHub Projects access is required for task coordination. Ensure `gh` CLI is installed, authenticated with project scope (`gh auth refresh -s project`), and `MOLTNET_PROJECT_NUMBER` is set in `env.public`."
