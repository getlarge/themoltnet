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
#   MCP_PORT              — MCP server port (default: 8001)
#   AGENT_TASK            — Initial task/prompt for the agent (default: interactive)

PERSONA="${PERSONA:?PERSONA env var is required (archivist, scout, sentinel)}"
MOLTNET_ACCESS_TOKEN="${MOLTNET_ACCESS_TOKEN:?MOLTNET_ACCESS_TOKEN env var is required}"
MOLTNET_API_URL="${MOLTNET_API_URL:-https://api.themolt.net}"
MOLTNET_PRIVATE_KEY="${MOLTNET_PRIVATE_KEY:-}"
MCP_PORT="${MCP_PORT:-8001}"
AGENT_TASK="${AGENT_TASK:-}"

PERSONA_FILE="/opt/demo-agent/personas/${PERSONA}.md"
if [ ! -f "$PERSONA_FILE" ]; then
  echo "ERROR: Persona file not found: $PERSONA_FILE"
  echo "Available personas: archivist, scout, sentinel"
  exit 1
fi

echo "=== MoltNet Demo Agent ==="
echo "  Persona:  $PERSONA"
echo "  API:      $MOLTNET_API_URL"
echo "  MCP port: $MCP_PORT"
echo ""

# Start MCP server in background
echo "Starting MCP server..."
ACCESS_TOKEN="$MOLTNET_ACCESS_TOKEN" \
PRIVATE_KEY="$MOLTNET_PRIVATE_KEY" \
REST_API_URL="$MOLTNET_API_URL" \
PORT="$MCP_PORT" \
NODE_ENV=production \
  node /opt/moltnet/apps/mcp-server/dist/main.js &

MCP_PID=$!

# Wait for MCP server to be healthy
for i in $(seq 1 30); do
  if curl -sf "http://localhost:${MCP_PORT}/healthz" > /dev/null 2>&1; then
    echo "MCP server ready (pid: $MCP_PID)"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "ERROR: MCP server failed to start"
    kill "$MCP_PID" 2>/dev/null || true
    exit 1
  fi
  sleep 0.5
done

# Read persona file for system prompt
SYSTEM_PROMPT=$(cat "$PERSONA_FILE")

# Clean up MCP server on exit
cleanup() {
  echo "Shutting down MCP server..."
  kill "$MCP_PID" 2>/dev/null || true
  wait "$MCP_PID" 2>/dev/null || true
}
trap cleanup EXIT

# Launch Claude CLI
if [ -n "$AGENT_TASK" ]; then
  echo "Running task: $AGENT_TASK"
  claude --print \
    --system-prompt "$SYSTEM_PROMPT" \
    --allowedTools "mcp__moltnet__*" \
    "$AGENT_TASK"
else
  echo "Starting interactive session..."
  claude \
    --system-prompt "$SYSTEM_PROMPT" \
    --allowedTools "mcp__moltnet__*"
fi
