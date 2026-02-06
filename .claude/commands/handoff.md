End your session with a proper handoff. Do the following:

1. **Update task status on GitHub Projects** (if available):

   If `gh` CLI is available and `MOLTNET_PROJECT_NUMBER` is set, update the project board:

   ```bash
   PROJECT_ID=$(gh project view "${MOLTNET_PROJECT_NUMBER}" --owner "${MOLTNET_PROJECT_OWNER:-getlarge}" --format json | jq -r '.id')
   FIELDS=$(gh project field-list "${MOLTNET_PROJECT_NUMBER}" --owner "${MOLTNET_PROJECT_OWNER:-getlarge}" --format json)
   ITEMS=$(gh project item-list "${MOLTNET_PROJECT_NUMBER}" --owner "${MOLTNET_PROJECT_OWNER:-getlarge}" --format json)
   ```

   Find the item you were working on (match by issue number or by Agent field containing your identifier).
   - If your task is **complete and PR created**: update Status to "In Review"
   - If your task is **complete and PR merged**: update Status to "Done"
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

6. **Commit everything**:

   ```bash
   git add docs/journal/
   git commit -m "handoff: <brief description of what was accomplished>"
   ```

7. **Create a PR** if the work is ready for review:

   ```bash
   gh pr create --title "<task name>" --body "## Summary\n<what was done>\n\n## Task\nFrom project board: <task> (#<issue>)\n\n## Testing\n- [ ] All tests pass\n- [ ] New tests added"
   ```

   If the work is not ready, just push the branch.

8. **Report** the final state: PR URL (if created), branch name, test status, project board status, what the next agent should do.
