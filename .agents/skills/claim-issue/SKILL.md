---
name: claim-issue
description: Claim a GitHub issue for work — load the legreffier skill, create a worktree + branch from origin/main, assign the issue to legreffier, and try to add it to the MoltNet Agent Board project. Use when the user says "let's work on issue <N>", "claim <issue-url>", "start issue <N>", or pastes a getlarge/themoltnet issue URL with intent to work on it.
---

# claim-issue

Claim a GitHub issue and set up an isolated workspace to work on it. Works in Claude Code and Codex (read the same file).

## Inputs

Accept either form via `$ARGUMENTS` or by parsing the user's message:

- Issue number: `123`
- Full URL: `https://github.com/getlarge/themoltnet/issues/123`

Default repo: `getlarge/themoltnet`. If a URL points to a different repo, refuse and ask the user to confirm — this skill is scoped to MoltNet.

## Steps

Minimize user confirmations. Prefer at most **two** confirmations for the whole workflow:

1. a **read-only / metadata** phase: resolve the agent identity if needed, mint the agent `GH_TOKEN`, and fetch the issue metadata
2. a **mutation** phase: fetch `origin/main`, create the worktree + branch, assign the issue, and attempt the project-board add

Still print the exact command or command batch before running it, but batch related shell commands together unless a failure mode requires a decision point. If a command needs network or sandbox escalation, request that escalation directly instead of doing an extra confirmation-only round trip first.

### 1. Load the legreffier skill first

Before any `gh` or `git` work, invoke the `legreffier` skill (via `Skill` in Claude Code, equivalent loader in Codex). Legreffier knows:

- How to resolve `AGENT_NAME` from `GIT_CONFIG_GLOBAL` / `MOLTNET_AGENT_NAME` / `.moltnet/` layout
- How to mint a `GH_TOKEN` from `.moltnet/<AGENT_NAME>/moltnet.json` per `.claude/rules/legreffier-gh.md`
- How to handle worktree symlinking of `.moltnet/`

Don't duplicate that logic here. Once legreffier is active, the rest of the steps just use the `gh`/`git` patterns it established.

### 2. Fetch issue metadata

```bash
GH_TOKEN=$(moltnet github token --credentials "<ABSOLUTE-CREDS-PATH>") \
  gh issue view <N> --repo getlarge/themoltnet --json number,title,labels,state,url
```

Run with the agent `GH_TOKEN` resolved by legreffier (per the legreffier-gh rule) using an **absolute** path to `.moltnet/<AGENT_NAME>/moltnet.json`. Do not use `--agent`; the stable CLI form is `--credentials <absolute-path>`. If `moltnet github token` returns empty, stop rather than letting `gh` fall back to the human token.

Use the title to derive a branch slug:

- Lowercase, replace non-alphanumerics with `-`, collapse repeats, trim ends
- Truncate to ~40 chars at a word boundary
- Branch name: `issue-<N>-<slug>` (e.g. `issue-456-fix-keto-policy-drift`)

Show the derived branch name and the planned worktree path. If `state` is `closed`, ask whether to proceed. Otherwise, use this as the end of the read-only phase and get a single confirmation for the mutation batch.

### 3. Create worktree + branch from origin/main

Always branch from a freshly fetched `origin/main`, not local `main`.

```bash
git fetch origin main
WORKTREE="../themoltnet-issue-<N>"
git worktree add -b issue-<N>-<slug> "$WORKTREE" origin/main
```

Batch this with steps 4, 5, and 6 when asking for the mutation-phase confirmation. Print the absolute worktree path.

After the worktree is created, install workspace dependencies there so the branch is immediately runnable:

```bash
pnpm install
```

Run it inside the new worktree path. If the workspace already shares `node_modules` another way, this may be a quick no-op; otherwise it bootstraps the branch for test and build work.

### 4. Install dependencies in the new worktree

```bash
pnpm install
```

Run from the new worktree root. If it fails because of sandboxed network access, rerun with escalation rather than asking the user to debug package-manager plumbing manually.

### 5. Assign issue to legreffier

```bash
GH_TOKEN=$(moltnet github token --credentials "<ABSOLUTE-CREDS-PATH>") \
  gh issue edit <N> --repo getlarge/themoltnet --add-assignee legreffier
```

Verified working with the agent token (2026-05).

### 6. Try to add issue to MoltNet Agent Board (project #3)

```bash
GH_TOKEN=$(moltnet github token --credentials "<ABSOLUTE-CREDS-PATH>") \
  gh project item-add 3 --owner getlarge --url https://github.com/getlarge/themoltnet/issues/<N>
```

This will likely fail. Don't treat it as a blocker.

**If it fails with `Could not resolve to a ProjectV2 with the number 3`:** the token lacks `project` scope. This is GitHub's misleading way of reporting a scope failure rather than a 404. Explain to the user:

> The agent's GitHub App token doesn't carry `project` scope (GitHub Apps don't grant it alongside contents/issues/pulls), so this step can't be automated under legreffier. Your personal `gh` token also needs `project` scope — if you want to run this step yourself, do it once:
>
> ```
> gh auth refresh -s project
> gh project item-add 3 --owner getlarge --url https://github.com/getlarge/themoltnet/issues/<N>
> ```
>
> Or add it via the web UI: https://github.com/users/getlarge/projects/3

Project metadata for reference: owner `getlarge`, number `3`, id `PVT_kwHOAOnyU84BOd17`.

Continue to step 7 regardless of outcome.

### 7. Hand off

Report a 4-line checklist of what actually ran vs. was skipped:

- [x/!] legreffier skill loaded
- [x/!] worktree created at `<path>` on branch `issue-<N>-<slug>`
- [x/!] issue assigned to `legreffier`
- [x/!/manual] added to MoltNet Agent Board

Tell the user to `cd` into the worktree before starting the actual work, so subsequent `git` commits land on the new branch and the diary entries pick up the right agent identity.

## Failure modes to surface, not hide

- **`gh` falls back to personal token** (rule violation): if legreffier's `GH_TOKEN` resolution returns empty, stop. Don't run any `gh` command bare — the action would be attributed to the human.
- **Branch already exists**: `git worktree add -b` fails. Offer `git worktree add "$WORKTREE" issue-<N>-<slug>` (no `-b`) to reuse the existing branch instead of silently overwriting.
- **Worktree path collision**: pick `../themoltnet-issue-<N>-<n>` with an incrementing suffix and tell the user why.
- **Issue not found / wrong repo**: stop before creating a branch.
- **Network/sandbox boundary**: if `gh` or `git fetch` fails due to sandboxed network access, rerun with escalation immediately instead of asking for a separate manual confirmation first.
