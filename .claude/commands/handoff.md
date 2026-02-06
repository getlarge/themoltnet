End your session with a proper handoff. Do the following:

1. **Update task status on GitHub Projects** (if available):

   If `gh` CLI is available and `MOLTNET_PROJECT_NUMBER` is set, update the project board:

   ```bash
   PROJECT_ID=$(gh project view "${MOLTNET_PROJECT_NUMBER}" --owner "${MOLTNET_PROJECT_OWNER:-getlarge}" --format json | jq -r '.id')
   FIELDS=$(gh project field-list "${MOLTNET_PROJECT_NUMBER}" --owner "${MOLTNET_PROJECT_OWNER:-getlarge}" --format json)
   ITEMS=$(gh project item-list "${MOLTNET_PROJECT_NUMBER}" --owner "${MOLTNET_PROJECT_OWNER:-getlarge}" --format json)
   ```

   Find the item you were working on (match by issue number or by Agent field containing your identifier).
   - If your task is **complete and ready for PR**: you'll signal this via the signal file (step 5)
   - If your task is **not complete**: keep Status as "In Progress", note progress in the Agent field

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

6. **Commit and push**:

   ```bash
   git add docs/journal/ <other changed files>
   git commit -m "handoff: <brief description of what was accomplished>"
   git push -u origin <branch-name>
   ```

7. **Signal for PR creation** — If the work is ready for review, update the signal file to trigger automatic PR creation:

   ```bash
   # Update .agent-claim.json — set phase to ready_for_pr and fill in the summary
   cat > .agent-claim.json << SIGNAL
   {
     "item_id": "$(jq -r '.item_id' .agent-claim.json)",
     "issue_number": $(jq -r '.issue_number' .agent-claim.json),
     "branch": "$(git branch --show-current)",
     "agent_id": "$(jq -r '.agent_id' .agent-claim.json)",
     "phase": "ready_for_pr",
     "summary": "<1-sentence description of the PR>",
     "status": "In Review",
     "pr_number": null,
     "last_check_poll": null
   }
   SIGNAL
   ```

   The on-stop hook will detect `phase: ready_for_pr` and automatically:
   - Create the PR with mission integrity checklist
   - Update the signal file with the PR number
   - Set the project board to "In Review"

   If the work is **not ready** for PR, leave `phase` as `coding` and just push the branch.

8. **Report** the final state: branch name, test status, project board status, what the next agent should do. If the hook created a PR, it will appear in the `additionalContext` of the next response.

## After PR is merged

When the on-idle hook detects the PR was merged, it will prompt you:
> "PR #N merged! Should I close issue #M?"

If the user confirms, update the signal file to trigger cleanup:

```bash
# Read existing values and write phase: done
cat > .agent-claim.json << SIGNAL
{
  "item_id": "$(jq -r '.item_id' .agent-claim.json)",
  "issue_number": $(jq -r '.issue_number' .agent-claim.json),
  "branch": "$(jq -r '.branch' .agent-claim.json)",
  "agent_id": "$(jq -r '.agent_id' .agent-claim.json)",
  "phase": "done",
  "summary": "$(jq -r '.summary' .agent-claim.json)",
  "status": "Done",
  "pr_number": $(jq -r '.pr_number' .agent-claim.json),
  "last_check_poll": null
}
SIGNAL
```

The on-stop hook will then:
- Close the issue with a comment linking the PR
- Update the project board to "Done"
- Delete the signal file
