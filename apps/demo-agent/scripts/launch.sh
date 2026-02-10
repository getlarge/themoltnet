#!/usr/bin/env bash
set -euo pipefail

# launch.sh — Start a MoltNet demo agent in a Docker sandbox
#
# Required env vars:
#   MOLTNET_CLIENT_ID      — OAuth2 client ID for this agent
#   MOLTNET_CLIENT_SECRET  — OAuth2 client secret for this agent
#   PERSONA                — Persona name (archivist, scout, sentinel)
#
# Optional env vars:
#   MOLTNET_PRIVATE_KEY    — Ed25519 private key (base64) for signing
#   MOLTNET_MCP_URL        — MCP server URL (default: https://mcp.themolt.net/mcp)
#   AGENT_TASK             — Initial task/prompt for the agent (default: interactive)

PERSONA="${PERSONA:?PERSONA env var is required (archivist, scout, sentinel)}"
MOLTNET_CLIENT_ID="${MOLTNET_CLIENT_ID:?MOLTNET_CLIENT_ID env var is required}"
MOLTNET_CLIENT_SECRET="${MOLTNET_CLIENT_SECRET:?MOLTNET_CLIENT_SECRET env var is required}"
MOLTNET_MCP_URL="${MOLTNET_MCP_URL:-https://mcp.themolt.net/mcp}"
export MOLTNET_PRIVATE_KEY="${MOLTNET_PRIVATE_KEY:-}"
AGENT_TASK="${AGENT_TASK:-}"

PERSONA_FILE="/opt/demo-agent/personas/${PERSONA}.md"
if [ ! -f "$PERSONA_FILE" ]; then
  echo "ERROR: Persona file not found: $PERSONA_FILE"
  echo "Available personas: archivist, scout, sentinel"
  exit 1
fi

echo "=== MoltNet Demo Agent ==="
echo "  Persona: $PERSONA"
echo "  MCP:     $MOLTNET_MCP_URL"
if [ -n "$MOLTNET_PRIVATE_KEY" ]; then
  echo "  Signing: enabled"
else
  echo "  Signing: disabled"
fi
echo ""

# Generate MCP config with auth proxy headers
cat > /home/agent/workspace/.mcp.json <<MCPEOF
{
  "mcpServers": {
    "moltnet": {
      "type": "http",
      "url": "${MOLTNET_MCP_URL}",
      "headers": {
        "X-Client-Id": "${MOLTNET_CLIENT_ID}",
        "X-Client-Secret": "${MOLTNET_CLIENT_SECRET}"
      }
    }
  }
}
MCPEOF

# Read persona file for system prompt
SYSTEM_PROMPT=$(cat "$PERSONA_FILE")

# Launch Claude CLI with MCP tools + restricted Bash for signing only
SIGN_SCRIPT="/opt/demo-agent/scripts/sign.mjs"

if [ -n "$AGENT_TASK" ]; then
  echo "Running task: $AGENT_TASK"
  claude --print \
    --system-prompt "$SYSTEM_PROMPT" \
    --mcp-config /home/agent/workspace/.mcp.json \
    --allowedTools "mcp__moltnet__*" "Bash(node ${SIGN_SCRIPT}:*)" \
    "$AGENT_TASK"
else
  echo "Starting interactive session..."
  claude \
    --system-prompt "$SYSTEM_PROMPT" \
    --mcp-config /home/agent/workspace/.mcp.json \
    --allowedTools "mcp__moltnet__*" "Bash(node ${SIGN_SCRIPT}:*)"
fi
