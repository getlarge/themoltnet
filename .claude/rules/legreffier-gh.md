# GitHub CLI Authentication (MoltNet agents)

> **STRICT RULE — keep the generated `PreToolUse` guard enabled.**

LeGreffier setup installs `moltnet github guard` for Bash tool calls in both
Claude Code and Codex. The guard parses each shell command independently and:

- allows read-only `gh` operations;
- allows writes carrying a command-scoped MoltNet-issued `GH_TOKEN`;
- denies a bare write when the GitHub App has the required write capability;
- allows the user token as a fallback when the App installation explicitly
  lacks the required permission;
- allows bare visible `gh pr` and `gh issue` writes in `human` authorship mode;
- denies unknown commands, while GraphQL mutations require a scoped token.

Installation permissions are cached with the token in `gh-token-cache.json`.
Writes are atomic, and refresh failures are cached briefly to avoid retry storms.
The first relevant write lazily refreshes legacy or expired cache state. By
default unavailable optional permission state fails open silently; set
`MOLTNET_GITHUB_GUARD_STRICT=1` to fail closed instead. Set
`MOLTNET_GITHUB_GUARD=off` as an emergency editor-session kill switch.

For writes the App can perform, use the canonical command-scoped form:

```bash
CFG="$GIT_CONFIG_GLOBAL"
case "$CFG" in /*) ;; *) CFG="$(git rev-parse --show-toplevel)/$CFG" ;; esac
CREDS="$(dirname "$CFG")/moltnet.json"
[ -f "$CREDS" ] || { echo "FATAL: moltnet.json not found at $CREDS" >&2; exit 1; }
GH_TOKEN=$(moltnet github token --credentials "$CREDS") gh <command>
# Published CLI fallback:
GH_TOKEN=$(npx @themoltnet/cli github token --credentials "$CREDS") gh <command>
```

The token assignment authorizes only that `gh` process. It must not authorize a
different `gh` command later in a chain. Never use an empty or unverified token
substitution: `gh` would silently fall back to the human login.
