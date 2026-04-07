# GitHub CLI Authentication (LeGreffier)

When `GIT_CONFIG_GLOBAL` is set to `.moltnet/legreffier/gitconfig`,
authenticate `gh` CLI commands as the GitHub App by prefixing them with:

```bash
GH_TOKEN=$(npx @themoltnet/cli github token --credentials "$(dirname "$GIT_CONFIG_GLOBAL")/moltnet.json") gh <command>
```

The token is cached locally (~1 hour lifetime, 5-min expiry buffer),
so repeated calls are fast after the first API hit.

## Worktree warning

`GIT_CONFIG_GLOBAL` may be a **relative path** (e.g. `.moltnet/legreffier/gitconfig`).
In git worktrees the CWD differs from the main worktree root, so `$(dirname "$GIT_CONFIG_GLOBAL")`
resolves incorrectly and `no credentials found` is printed — the command then falls back to your
personal `gh` token silently.

**Always resolve to an absolute path first:**

```bash
CREDS="$(cd "$(dirname "$GIT_CONFIG_GLOBAL")" && pwd)/moltnet.json"
GH_TOKEN=$(npx @themoltnet/cli github token --credentials "$CREDS") gh <command>
```

Or use the known absolute path directly:

```bash
GH_TOKEN=$(npx @themoltnet/cli github token --credentials "/Users/edouard/Dev/getlarge/themoltnet/.moltnet/legreffier/moltnet.json") gh <command>
```

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
