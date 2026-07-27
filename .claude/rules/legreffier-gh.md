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
- denies unknown commands, while GraphQL mutations require a scoped token;
- resolves shell variables assigned to **statically determinable** values, so a
  scoped token, endpoint, or payload passed via `$VAR` (e.g.
  `--credentials "$CREDS"`, `--input "$JSON"`) is verified without executing
  anything. A value derived from a command substitution (`$(dirname …)`), or a
  variable assigned more than once (including a conditional `case` re-assignment),
  stays opaque and is denied — the guard never runs shell to learn it.

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

The `$(dirname "$CFG")` derivation above is dynamic, so the guard cannot
pre-verify the token minted from it — it will fall through to the normal
"attribute with a scoped token" deny when the App holds the permission. When you
need the guard to attribute the token (for example submitting a multi-comment PR
review via `gh api`, the only endpoint that carries line-anchored threads), pass
the credentials path as a literal or a single statically-assigned variable so the
guard can verify it:

```bash
# Absolute creds path assigned once, statically → the guard verifies the token.
CREDS=/abs/path/.moltnet/<AGENT_NAME>/moltnet.json
GH_TOKEN=$(moltnet github token --credentials "$CREDS") \
  gh api --method POST repos/<owner>/<repo>/pulls/<N>/reviews --input review.json
```

The token assignment authorizes only that `gh` process. It must not authorize a
different `gh` command later in a chain. Never use an empty or unverified token
substitution: `gh` would silently fall back to the human login.
