#!/usr/bin/env bash
# SessionStart hook: install dependencies, moltnet CLI, and agent config
set -euo pipefail

# Only run in remote (web) sessions
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# Install Node.js dependencies (idempotent, cached between sessions)
if [ ! -d "node_modules" ]; then
  pnpm install --frozen-lockfile
fi

# Install moltnet CLI binary (downloads Go binary from GitHub releases)
CLI_BIN="$CLAUDE_PROJECT_DIR/packages/cli/bin/moltnet"
if [ ! -x "$CLI_BIN" ]; then
  cd "$CLAUDE_PROJECT_DIR/packages/cli"
  node install.js
  cd "$CLAUDE_PROJECT_DIR"
fi

# Symlink to PATH so `moltnet` command works globally
if [ -x "$CLI_BIN" ] && [ ! -f /usr/local/bin/moltnet ]; then
  ln -sf "$CLI_BIN" /usr/local/bin/moltnet
fi

# Reconstruct agent config from env vars if MOLTNET_AGENT_NAME is set
# and the agent directory doesn't exist yet.
# Set MOLTNET_AGENT_NAME and credential env vars in Claude Code project settings.
if [ -n "${MOLTNET_AGENT_NAME:-}" ] && [ -n "${MOLTNET_IDENTITY_ID:-}" ]; then
  if [ ! -f "$CLAUDE_PROJECT_DIR/.moltnet/$MOLTNET_AGENT_NAME/moltnet.json" ]; then
    moltnet config init-from-env --agent "$MOLTNET_AGENT_NAME" --dir "$CLAUDE_PROJECT_DIR"
  fi

  # Export GIT_CONFIG_GLOBAL for commit signing
  GITCONFIG="$CLAUDE_PROJECT_DIR/.moltnet/$MOLTNET_AGENT_NAME/gitconfig"
  if [ -f "$GITCONFIG" ] && [ -n "${CLAUDE_ENV_FILE:-}" ]; then
    echo "export GIT_CONFIG_GLOBAL='$GITCONFIG'" >> "$CLAUDE_ENV_FILE"
  fi
fi
