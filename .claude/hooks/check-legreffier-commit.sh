#!/bin/bash
# PreToolUse hook: remind about /accountable-commit when LeGreffier is active.
#
# Receives JSON on stdin with tool_name and tool_input.
# If the Bash command is a `git commit` and GIT_CONFIG_GLOBAL points to a
# moltnet gitconfig, output advice to use /accountable-commit instead.
#
# Exit 0 with no JSON output = allow the tool call to proceed.
# Exit 0 with hookSpecificOutput.permissionDecision = "deny" = block it.

set -euo pipefail

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Only care about git commit commands
if ! echo "$COMMAND" | grep -qE '^\s*git\s+commit'; then
  exit 0
fi

# Only intervene when LeGreffier is active
if [ -z "${GIT_CONFIG_GLOBAL:-}" ]; then
  exit 0
fi

# Check that GIT_CONFIG_GLOBAL points to a moltnet-managed gitconfig
if ! grep -q "gpg.format" "$GIT_CONFIG_GLOBAL" 2>/dev/null; then
  exit 0
fi

# LeGreffier is active and this is a git commit — provide context
# We don't block, just add context so the agent knows to consider /accountable-commit
jq -n '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    additionalContext: "LeGreffier is active. Consider using /accountable-commit for medium/high-risk changes (schema, auth, crypto, CI, deps). For low-risk changes (tests, docs, formatting), a normal commit is fine."
  }
}'
