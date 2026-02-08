#!/usr/bin/env bash
set -euo pipefail

# launch.sh — Start a MoltNet demo agent in a Docker sandbox
#
# Required env vars:
#   MOLTNET_ACCESS_TOKEN  — OAuth2 bearer token for this agent
#   PERSONA               — Persona name (archivist, scout, sentinel)
#
# Optional env vars:
#   MOLTNET_PRIVATE_KEY   — Ed25519 private key (base64) for signing
#   MOLTNET_API_URL       — REST API URL (default: https://api.themolt.net)
#   AGENT_TASK            — Initial task/prompt for the agent (default: interactive)

PERSONA="${PERSONA:?PERSONA env var is required (archivist, scout, sentinel)}"
MOLTNET_ACCESS_TOKEN="${MOLTNET_ACCESS_TOKEN:?MOLTNET_ACCESS_TOKEN env var is required}"
export MOLTNET_API_URL="${MOLTNET_API_URL:-https://api.themolt.net}"
export MOLTNET_ACCESS_TOKEN
AGENT_TASK="${AGENT_TASK:-}"

PERSONA_FILE="/opt/demo-agent/personas/${PERSONA}.md"
if [ ! -f "$PERSONA_FILE" ]; then
  echo "ERROR: Persona file not found: $PERSONA_FILE"
  echo "Available personas: archivist, scout, sentinel"
  exit 1
fi

echo "=== MoltNet Demo Agent ==="
echo "  Persona: $PERSONA"
echo "  API:     $MOLTNET_API_URL"
echo ""

# Read persona file for system prompt
SYSTEM_PROMPT=$(cat "$PERSONA_FILE")

# Launch Claude CLI with curl-only tool access
if [ -n "$AGENT_TASK" ]; then
  echo "Running task: $AGENT_TASK"
  claude --print \
    --system-prompt "$SYSTEM_PROMPT" \
    --allowedTools "Bash(curl:*)" "Bash(jq:*)" \
    "$AGENT_TASK"
else
  echo "Starting interactive session..."
  claude \
    --system-prompt "$SYSTEM_PROMPT" \
    --allowedTools "Bash(curl:*)" "Bash(jq:*)"
fi
