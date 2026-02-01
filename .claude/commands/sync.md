Check the current coordination state before starting work. Do the following:

1. Read `TASKS.md` in the repo root. Report:
   - Which tasks are Active (in-progress by other agents)
   - Which tasks are Available (you could claim one)
   - Which tasks are Completed recently

2. Check open pull requests (using `gh` CLI):

   ```bash
   gh pr list --limit 10 --json number,title,headRefName,state,statusCheckRollup
   ```

   Report what PRs are open and their CI status.

3. Check recent CI runs:

   ```bash
   gh run list --limit 5 --json conclusion,headBranch,name,startedAt
   ```

   Report if main is green or broken.

4. Check if there are new commits on main (using `gh` API):

   ```bash
   gh api repos/:owner/:repo/commits?sha=main --jq '.[0:5] | .[] | "\(.sha[0:7]) \(.commit.message | split("\n")[0])"'
   ```

   Report recent activity on main.

5. Read the most recent handoff entry in `docs/journal/` to understand what the last agent did.

6. Summarize:
   - What other agents are working on
   - What's available for you
   - Recent main branch activity
   - Any blockers or conflicts to be aware of

**Note**: This command works in both host and sandbox environments. If in a sandbox, it uses `gh` CLI exclusively (no git commands) since git operations don't work in Docker sandboxes.
