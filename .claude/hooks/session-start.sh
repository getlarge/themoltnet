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

# Reconstruct the selected identity from session environment settings.
# Raw agent keys are revalidated even when the identity directory exists.
identity="${MOLTNET_ACTIVE_IDENTITY:-${MOLTNET_AGENT_NAME:-}}"
if [ -n "$identity" ] && {
  [ -n "${MOLTNET_SUBJECT_ID:-}" ] ||
    [ -n "${MOLTNET_SUBJECT_TYPE:-}" ] ||
    [ -n "${MOLTNET_IDENTITY_ID:-}" ]
}; then
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

  cli_version="${MOLTNET_CLI_VERSION:-latest}"
  identity_dir="$HOME/.config/moltnet/identities/$identity"
  if [ ! -f "$identity_dir/moltnet.json" ] || [ -n "${MOLTNET_AGENT_KEY:-}" ]; then
    # Follow the published CLI by default. Operators may pin
    # a release supporting agent-key bootstrap with MOLTNET_CLI_VERSION.
    npx --yes "@themoltnet/cli@$cli_version" config init-from-env \
      --name "$identity"
    if [ ! -f "$identity_dir/moltnet.json" ]; then
      echo "moltnet: config init-from-env did not create $identity_dir/moltnet.json." >&2
      echo "moltnet: the resolved @themoltnet/cli predates the central identity store;" >&2
      echo "moltnet: pin a supported release with MOLTNET_CLI_VERSION." >&2
      exit 1
    fi
  fi

  # Check on every start, including sessions with an existing identity.
  # whoami exposes expiry with agent:profile; key:manage is unnecessary.
  if [ -n "${MOLTNET_AGENT_KEY:-}" ]; then
    npx --yes "@themoltnet/cli@$cli_version" agents whoami \
      --warn-expiry-days "${MOLTNET_AGENT_KEY_WARN_DAYS:-7}" >/dev/null || {
      echo "moltnet: agent-key check failed; verify agent:profile and replace an expired or revoked key in the session environment." >&2
      exit 1
    }
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
