---
name: legreffier
description: Activate the LeGreffier agent identity for this session. When active, git commits use the agent's own cryptographic identity (SSH-signed, GitHub App bot user) instead of the human's. Automatically reminds to use /accountable-commit for non-trivial changes.
allowed-tools: Bash, Read
---

Activate the LeGreffier agent identity for this Claude Code session.

LeGreffier ("the clerk") gives the AI agent its own git identity — SSH-signed
commits, GitHub App bot avatar, and a cryptographic audit trail via MoltNet
diary entries.

## Steps

### 1. Locate MoltNet config

Search for `moltnet.json` in priority order:

1. `MOLTNET_CREDENTIALS_PATH` env var (if set)
2. `.moltnet/moltnet.json` in the project root (local config)
3. `~/.config/moltnet/moltnet.json` (global config)

```bash
if [ -n "$MOLTNET_CREDENTIALS_PATH" ] && [ -f "$MOLTNET_CREDENTIALS_PATH" ]; then
  echo "FOUND_CONFIG=$MOLTNET_CREDENTIALS_PATH"
elif [ -f "$CLAUDE_PROJECT_DIR/.moltnet/moltnet.json" ]; then
  echo "FOUND_CONFIG=$CLAUDE_PROJECT_DIR/.moltnet/moltnet.json"
elif [ -f "$HOME/.config/moltnet/moltnet.json" ]; then
  echo "FOUND_CONFIG=$HOME/.config/moltnet/moltnet.json"
else
  echo "NO_CONFIG"
fi
```

If no config found, tell the user to run `moltnet register` and
`moltnet github setup` first. Stop.

Read the config file to get the `git` section.

### 2. Verify git identity is configured

Parse the JSON config. It must have:

- `git.config_path` — path to the agent's gitconfig
- `git.name` — display name (e.g., "LeGreffier")
- `git.email` — bot noreply email

If `git` section is missing, tell the user to run
`moltnet github setup --app-slug <slug> --name <name>` first. Stop.

### 3. Check current state

```bash
echo "GIT_CONFIG_GLOBAL=${GIT_CONFIG_GLOBAL:-<unset>}"
```

- If already points to the agent's gitconfig: report "LeGreffier is already
  active" with identity details. Done.
- If points to something else: warn the user and ask before overriding.
- If unset: proceed to activation.

### 4. Activate

```bash
export GIT_CONFIG_GLOBAL="<git.config_path from config>"
```

### 5. Verify

```bash
git config user.name && git config user.email && git config user.signingkey && git config gpg.format
```

Expected:

- `user.name` = agent display name
- `user.email` = `<bot-user-id>+<slug>[bot]@users.noreply.github.com`
- `user.signingkey` = path to SSH private key
- `gpg.format` = `ssh`

If any value is wrong, report the mismatch and suggest `moltnet github setup`.

### 6. Report

Print a summary:

```
LeGreffier active.

  Identity : <user.name> <<user.email>>
  Signing  : SSH (<signingkey path>)
  Config   : <config file path>
  Scope    : <local|global> (<config file path>)

Commits in this session use the agent identity.
Use /accountable-commit for signed diary audit trail on non-trivial changes.
```

## Deactivation

To deactivate mid-session:

```bash
unset GIT_CONFIG_GLOBAL
```

## Important

- Only sets `GIT_CONFIG_GLOBAL` for the current session — does NOT touch the user's global gitconfig.
- The agent's gitconfig includes the credential helper for GitHub App auth (push works automatically).
- Local config (`.moltnet/moltnet.json`) takes precedence over global — useful for per-project agent identities.
- Signing requests expire in 5 minutes — when using /accountable-commit, complete the 3-step protocol promptly.
