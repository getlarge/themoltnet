Check the current coordination state before starting work. Do the following:

1. Read `TASKS.md` in the repo root. Report:
   - Which tasks are Active (in-progress by other agents)
   - Which tasks are Available (you could claim one)
   - Which tasks are Completed recently

2. Check open pull requests:

   ```bash
   gh pr list --limit 10
   ```

   Report what PRs are open and their CI status.

3. Check recent CI runs:

   ```bash
   gh run list --limit 5
   ```

   Report if main is green or broken.

4. Check if there are changes on main that you should rebase onto:

   ```bash
   git fetch origin main
   git log --oneline HEAD..origin/main -- . | head -10
   ```

5. Read the most recent handoff entry in `docs/journal/` to understand what the last agent did.

6. Summarize:
   - What other agents are working on
   - What's available for you
   - Whether you need to rebase
   - Any blockers or conflicts to be aware of
