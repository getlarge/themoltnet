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
  # The alias becomes a path segment and is written into a file that is later
  # sourced, so validate it before either use. This is the same grammar the Go
  # CLI enforces (agentNamePattern).
  case "$identity" in
    [A-Za-z0-9]*) ;;
    *) echo "moltnet: refusing invalid identity alias '$identity'" >&2; exit 1 ;;
  esac
  if [ "${#identity}" -gt 63 ] || printf '%s' "$identity" | LC_ALL=C grep -q '[^A-Za-z0-9._-]'; then
    echo "moltnet: refusing invalid identity alias '$identity'" >&2
    exit 1
  fi

  identity_dir="$HOME/.config/moltnet/identities/$identity"
  if [ ! -f "$identity_dir/moltnet.json" ]; then
    # Pinnable: the published CLI only grows central-identity support from the
    # release that introduces it, and an older cached build silently writes the
    # legacy repository layout, so the check above never satisfies and this
    # hook re-runs every session.
    npx --yes "@themoltnet/cli@${MOLTNET_CLI_VERSION:-latest}" config init-from-env \
      --name "$identity"
    if [ ! -f "$identity_dir/moltnet.json" ]; then
      echo "moltnet: config init-from-env did not create $identity_dir/moltnet.json." >&2
      echo "moltnet: the resolved @themoltnet/cli predates the central identity store;" >&2
      echo "moltnet: pin a supported release with MOLTNET_CLI_VERSION." >&2
      exit 1
    fi
  fi

  # Export GIT_CONFIG_GLOBAL for commit signing
  GITCONFIG="$identity_dir/gitconfig"
  if [ -f "$GITCONFIG" ] && [ -n "${CLAUDE_ENV_FILE:-}" ]; then
    printf "export GIT_CONFIG_GLOBAL='%s'\n" "$GITCONFIG" >> "$CLAUDE_ENV_FILE"
    printf "export MOLTNET_ACTIVE_IDENTITY='%s'\n" "$identity" >> "$CLAUDE_ENV_FILE"
  fi
fi
