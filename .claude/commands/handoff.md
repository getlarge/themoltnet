End your session with a proper handoff. Do the following:

1. **Update TASKS.md**:
   - If your task is complete: move it from "Active" to "Completed" with a PR link
   - If your task is in progress: update the status description in Active

2. **Write a journal handoff entry** in `docs/journal/` following the format in `docs/BUILDER_JOURNAL.md`:
   - What was done this session
   - What's not done yet
   - Current state (branch, test status, build status)
   - Decisions made
   - Open questions
   - Where to start next

3. **Update the journal index** in `docs/journal/README.md`

4. **Run validation**:

   ```bash
   pnpm run validate
   ```

   Report the results.

5. **Commit everything**:

   ```bash
   git add TASKS.md docs/journal/
   git commit -m "handoff: <brief description of what was accomplished>"
   ```

6. **Create a PR** if the work is ready for review:

   ```bash
   gh pr create --title "<task name>" --body "## Summary\n<what was done>\n\n## Task\nFrom TASKS.md: <task>\n\n## Testing\n- [ ] All tests pass\n- [ ] New tests added"
   ```

   If the work is not ready, just push the branch.

7. **Report** the final state: PR URL (if created), branch name, test status, what the next agent should do.
