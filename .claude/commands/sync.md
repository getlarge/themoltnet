---
description: Check the current coordination state before starting work. Do the following:
---

Check the current coordination state before starting work. Do the following:

1. **Check GitHub Project board**:

   First check if `gh` CLI is available and `MOLTNET_PROJECT_NUMBER` is set.
   If both are available:

   ```bash
   gh project item-list "${MOLTNET_PROJECT_NUMBER}" --owner "${MOLTNET_PROJECT_OWNER:-getlarge}" --format json
   ```

   Parse the JSON and report:
   - Items with Status "Todo" — tasks available to claim
   - Items with Status "In Progress" — what other agents are working on
   - Items with Status "In Review" — PRs awaiting review
   - Items with Status "Done" recently — what was just completed
   - Items with Readiness "Ready for Agent" — validated and ready to pick up

   If `gh` or the project is unavailable, tell the user to set up GitHub Projects access.

2. **Check open pull requests**:

   ```bash
   gh pr list --limit 10 --json number,title,headRefName,state,statusCheckRollup
   ```

   Report what PRs are open and their CI status.

3. **Check recent CI runs**:

   ```bash
   gh run list --limit 5 --json conclusion,headBranch,name,startedAt
   ```

   Report if main is green or broken.

4. **Check recent commits on main**:

   ```bash
   gh api repos/:owner/:repo/commits?sha=main --jq '.[0:5] | .[] | "\(.sha[0:7]) \(.commit.message | split("\n")[0])"'
   ```

5. **Read the most recent handoff** entry in `docs/journal/` to understand what the last agent did.

6. **Summarize**:
   - Project board state (todo / in-progress / done counts)
   - What other agents are working on
   - What's available for you
   - Recent main branch activity
   - Any blockers or conflicts to be aware of
