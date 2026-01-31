End your session with a proper handoff. Do the following:

1. **Update TASKS.md**:
   - If your task is complete: move it from "Active" to "Completed" with a PR link
   - If your task is in progress: update the status description in Active

2. **Check landing page status**: If workstream progress changed, update `apps/landing/src/components/Status.tsx` (the `workstreams` array) and adjust the test in `apps/landing/__tests__/landing.test.tsx` to match

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
   gh pr create --title "<task name>" --body "## Summary\n<what was done>\n\n## Task\nFrom TASKS.md: <task>\n\n## Testing\n- [ ] All tests pass\n- [ ] New tests added"
   ```

   If the work is not ready, just push the branch.

8. **Report** the final state: PR URL (if created), branch name, test status, what the next agent should do.
