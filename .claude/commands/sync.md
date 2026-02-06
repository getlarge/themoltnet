Check the current coordination state before starting work. Do the following:

1. **Check GitHub Project board** (primary source):

   First check if `gh` CLI is available and `MOLTNET_PROJECT_NUMBER` is set.
   If both are available:

   ```bash
   gh project item-list "${MOLTNET_PROJECT_NUMBER}" --owner "${MOLTNET_PROJECT_OWNER:-getlarge}" --format json
   ```

   Parse the JSON and report:
   - Items with Status "Todo" — tasks available to claim
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
