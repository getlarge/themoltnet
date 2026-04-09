# GitHub CLI Authentication (MoltNet agents)

> **STRICT RULE — read this before every `gh` call.**
>
> When `GIT_CONFIG_GLOBAL` is set (matches `.moltnet/<agent>/gitconfig`), you
> **MUST NOT** run bare `gh <command>`. You **MUST** prefix every `gh` call
> with a `GH_TOKEN` resolved from an **absolute path** to `moltnet.json`.
> Running bare `gh` silently falls back to the human personal token and
> attributes the action to the wrong identity — this is a correctness bug,
> not a warning.

## The only correct form

```bash
# 1. Resolve credentials to an ABSOLUTE path (never trust $GIT_CONFIG_GLOBAL as-is).
CREDS="$(cd "$(dirname "$GIT_CONFIG_GLOBAL")" 2>/dev/null && pwd)/moltnet.json"

# 2. Refuse to proceed if the file does not exist at that absolute path.
[ -f "$CREDS" ] || { echo "FATAL: moltnet.json not found at $CREDS" >&2; exit 1; }

# 3. Call gh with GH_TOKEN inlined.
GH_TOKEN=$(npx @themoltnet/cli github token --credentials "$CREDS") gh <command>
```

The credentials file (`moltnet.json`) always lives next to the `gitconfig`
inside the same `.moltnet/<agent>/` directory, regardless of which agent is
active. The token is cached locally (~1 hour lifetime, 5-min expiry buffer),
so repeated calls are fast after the first API hit.

## Why absolute paths are mandatory

`GIT_CONFIG_GLOBAL` is almost always a **relative path** (e.g. `.moltnet/<agent>/gitconfig`).
Every git worktree has a different CWD from the main worktree root, so
`$(dirname "$GIT_CONFIG_GLOBAL")` resolves differently depending on where you are.
When it resolves to a non-existent directory:

- `npx @themoltnet/cli github token` prints `no credentials found` to stderr,
- the command substitution yields an empty `GH_TOKEN`,
- `gh` silently falls back to your personal token,
- the resulting API call is attributed to the **human**, not the agent.

This failure is invisible in normal output. The `cd ... && pwd` dance in step 1
is the only reliable way to get an absolute path that works across worktrees.

## Forbidden patterns

- `gh <command>` — bare, no `GH_TOKEN`. **Never.**
- `GH_TOKEN=$(... --credentials "$(dirname "$GIT_CONFIG_GLOBAL")/moltnet.json") gh ...`
  — uses the raw relative path. Breaks in worktrees.
- `GH_TOKEN=$(... --credentials "./moltnet.json") gh ...` — relative. Breaks.
- `GH_TOKEN=$(... --credentials "~/.moltnet/...") gh ...` — `~` is not expanded
  inside double quotes; use `$HOME` or the literal absolute path.

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
