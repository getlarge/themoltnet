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
    # Pinned by default. This runs with OAuth, signing-key and optional GitHub
    # App secrets in the environment, so resolving a mutable `latest` would let
    # any future npm release read them. MOLTNET_CLI_VERSION overrides it
    # deliberately; it is never `latest` implicitly. A CLI predating the central
    # identity store also writes the legacy layout, so the document is verified
    # immediately below rather than letting this hook re-run every session.
    npx --yes "@themoltnet/cli@${MOLTNET_CLI_VERSION:-1.91.0}" config init-from-env \
      --name "$identity"
    if [ ! -f "$identity_dir/moltnet.json" ]; then
      echo "moltnet: config init-from-env did not create $identity_dir/moltnet.json." >&2
      echo "moltnet: the resolved @themoltnet/cli predates the central identity store;" >&2
      echo "moltnet: pin a supported release with MOLTNET_CLI_VERSION." >&2
      exit 1
    fi
  fi

  if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
    # The active identity is the SESSION ACTIVATION SIGNAL: the secrets guard
    # and the GitHub authorship guard both key on it. Export it whenever the
    # central document is valid, never conditionally on Git artifacts — an
    # identity created by `moltnet register` has no gitconfig, and gating on one
    # left that session classified as an ordinary human shell with every agent
    # protection silently disabled.
    printf "export MOLTNET_ACTIVE_IDENTITY='%s'\n" "$identity" >> "$CLAUDE_ENV_FILE"

    # Commit signing is a separate concern and genuinely does need the file.
    GITCONFIG="$identity_dir/gitconfig"
    if [ -f "$GITCONFIG" ]; then
      printf "export GIT_CONFIG_GLOBAL='%s'\n" "$GITCONFIG" >> "$CLAUDE_ENV_FILE"
    fi
  fi
fi
