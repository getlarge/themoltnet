# GitHub CLI Authentication (MoltNet agents)

> **STRICT RULE — read this before every `gh` call.**
>
> When `GIT_CONFIG_GLOBAL` is set (matches `.moltnet/<agent>/gitconfig`), the
> default is: you **MUST NOT** run bare `gh <command>`. You **MUST** prefix
> every `gh` call with a `GH_TOKEN` resolved from an **absolute path** to
> `moltnet.json`. Running bare `gh` silently falls back to the human personal
> token and attributes the action to the wrong identity — this is a
> correctness bug, not a warning.
>
> **Exception — `human` authorship mode**: when `MOLTNET_COMMIT_AUTHORSHIP=human`
> in `.moltnet/<agent>/env`, `gh pr ...` and `gh issue ...` **must** run bare
> (no `GH_TOKEN`) so the PR/issue appears as authored by the human. All other
> `gh` calls (including `gh api repos/.../contents/...`) still require the agent
> token. `git push` is not a `gh` call and always uses the agent token via the
> gitconfig-configured credential helper.

## The only correct form

```bash
# 1. Resolve credentials to an ABSOLUTE path. GIT_CONFIG_GLOBAL is typically
#    relative (e.g. .moltnet/<agent>/gitconfig). Anchor it against the repo
#    root so this works from any subdirectory or worktree, not just the root.
CFG="$GIT_CONFIG_GLOBAL"
case "$CFG" in /*) ;; *) CFG="$(git rev-parse --show-toplevel)/$CFG" ;; esac
CREDS="$(dirname "$CFG")/moltnet.json"

# 2. Refuse to proceed if the file does not exist at that absolute path.
[ -f "$CREDS" ] || { echo "FATAL: moltnet.json not found at $CREDS" >&2; exit 1; }

# 3. Call gh with GH_TOKEN inlined. Use the `moltnet` binary if it
#    is on PATH, otherwise fall back to `npx @themoltnet/cli`. Never
#    reference `$MOLTNET_CLI` here — it may be unset in ad-hoc shells
#    and expanding to empty silently swallows the subcommand, producing
#    an empty GH_TOKEN and falling back to your personal auth.
GH_TOKEN=$(moltnet github token --credentials "$CREDS") gh <command>
# or, if `moltnet` is not installed:
GH_TOKEN=$(npx @themoltnet/cli github token --credentials "$CREDS") gh <command>
```

The credentials file (`moltnet.json`) always lives next to the `gitconfig`
inside the same `.moltnet/<agent>/` directory, regardless of which agent is
active. The token is cached locally (~1 hour lifetime, 5-min expiry buffer),
so repeated calls are fast after the first API hit.

## Why absolute paths are mandatory

`GIT_CONFIG_GLOBAL` is almost always a **relative path** (e.g. `.moltnet/<agent>/gitconfig`),
interpreted by git relative to the repo root — not the shell's CWD. So a bare
`$(dirname "$GIT_CONFIG_GLOBAL")` resolves to a non-existent directory whenever
you run `gh` from a subdirectory (e.g. `packages/api`) or from a worktree whose
CWD differs from the main worktree root. When that happens:

- `moltnet github token` (or `npx @themoltnet/cli github token`) prints `no credentials found` to stderr,
- the command substitution yields an empty `GH_TOKEN`,
- `gh` silently falls back to your personal token,
- the resulting API call is attributed to the **human**, not the agent.

This failure is invisible in normal output. The `git rev-parse --show-toplevel`
anchoring in step 1 is the only reliable way to get an absolute path that works
from any CWD inside the repo (and any worktree). If the snippet is run outside
a git repo, `git rev-parse` exits non-zero and the whole pipeline fails loudly
instead of silently producing the wrong path.

## Forbidden patterns

- `gh <command>` — bare, no `GH_TOKEN`. **Never** (except the `human` mode
  write-op carve-out for `gh pr` / `gh issue` described in the header above).
- `GH_TOKEN=$(... --credentials "$(dirname "$GIT_CONFIG_GLOBAL")/moltnet.json") gh ...`
  — uses the raw relative path. Breaks in worktrees.
- `GH_TOKEN=$(... --credentials "./moltnet.json") gh ...` — relative. Breaks.
- `GH_TOKEN=$(... --credentials "~/.moltnet/...") gh ...` — `~` is not expanded
  inside double quotes; use `$HOME` or the literal absolute path.
- `GH_TOKEN=$($MOLTNET_CLI github token ...) gh ...` — do **not** reference the
  `$MOLTNET_CLI` variable in this rule. It is only set inside the legreffier
  skill session; in ad-hoc shells it expands to empty, the `github token`
  subcommand is swallowed, `GH_TOKEN` is empty, and `gh` silently falls back
  to the human token. Hardcode `moltnet` or `npx @themoltnet/cli`.

## Allowed `gh` subcommands

The GitHub App only has these permissions:

- `gh pr ...` (pull_requests: write)
- `gh issue ...` (issues: write)
- `gh api repos/{owner}/{repo}/contents/...` (contents: write)
- `gh repo view`, `gh repo clone` (metadata: read + contents: read)

Do NOT use `GH_TOKEN` for other `gh` commands (releases, actions, packages, etc.).

## 401 recovery

If you get a 401 error, the cached token may be stale. Delete
`gh-token-cache.json` next to `moltnet.json` and retry.
