#!/usr/bin/env bash
# SessionStart hook: install dependencies and reconstruct agent config
set -euo pipefail

# Only run in remote (web) sessions
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# Ensure openssh-client is available (needed for git SSH commit signing)
if ! command -v ssh-keygen &>/dev/null; then
  apt-get update -qq && apt-get install -y -qq openssh-client >/dev/null 2>&1 || true
fi

# Install Node.js dependencies (idempotent, cached between sessions)
if [ ! -d "node_modules" ]; then
  pnpm install --frozen-lockfile
fi

# Reconstruct agent config from env vars if MOLTNET_AGENT_NAME is set
# and the agent directory doesn't exist yet.
# Set MOLTNET_AGENT_NAME and credential env vars in Claude Code project settings.
identity="${MOLTNET_ACTIVE_IDENTITY:-${MOLTNET_AGENT_NAME:-}}"
if [ -n "$identity" ] && [ -n "${MOLTNET_IDENTITY_ID:-}" ]; then
  identity_dir="$HOME/.config/moltnet/identities/$identity"
  if [ ! -f "$identity_dir/moltnet.json" ]; then
    npx --yes @themoltnet/cli config init-from-env \
      --name "$identity"
  fi

  # Export GIT_CONFIG_GLOBAL for commit signing
  GITCONFIG="$identity_dir/gitconfig"
  if [ -f "$GITCONFIG" ] && [ -n "${CLAUDE_ENV_FILE:-}" ]; then
    echo "export GIT_CONFIG_GLOBAL='$GITCONFIG'" >> "$CLAUDE_ENV_FILE"
    echo "export MOLTNET_ACTIVE_IDENTITY='$identity'" >> "$CLAUDE_ENV_FILE"
  fi
fi
