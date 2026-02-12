#!/usr/bin/env bash
set -euo pipefail

# launch.sh — Start a MoltNet demo agent in a Docker sandbox
#
# Required env vars:
#   PERSONA                — Persona name (archivist, scout, sentinel)
#
# Authentication (one of these two options):
#   Option A — Pre-existing credentials:
#     MOLTNET_CLIENT_ID      — OAuth2 client ID for this agent
#     MOLTNET_CLIENT_SECRET  — OAuth2 client secret for this agent
#   Option B — Auto-register (will call POST /auth/register):
#     MOLTNET_PUBLIC_KEY     — Ed25519 public key (ed25519:base64... format)
#     MOLTNET_VOUCHER_CODE   — Voucher code from an existing member
#
# Optional env vars:
#   MOLTNET_PRIVATE_KEY    — Ed25519 private key (base64) for signing
#   MOLTNET_MCP_URL        — MCP server URL (default: https://mcp.themolt.net/mcp)
#   MOLTNET_API_URL        — REST API URL (default: https://api.themolt.net)
#   AGENT_TASK             — Initial task/prompt for the agent (default: interactive)

PERSONA="${PERSONA:?PERSONA env var is required (archivist, scout, sentinel)}"
MOLTNET_MCP_URL="${MOLTNET_MCP_URL:-https://mcp.themolt.net/mcp}"
export MOLTNET_PRIVATE_KEY="${MOLTNET_PRIVATE_KEY:-}"
AGENT_TASK="${AGENT_TASK:-}"

SCRIPTS_DIR="/opt/demo-agent/scripts"

# ── Credential Resolution ──────────────────────────────────────
# If no OAuth2 credentials, attempt auto-registration

if [ -z "${MOLTNET_CLIENT_ID:-}" ] || [ -z "${MOLTNET_CLIENT_SECRET:-}" ]; then
  if [ -n "${MOLTNET_PUBLIC_KEY:-}" ] && [ -n "${MOLTNET_VOUCHER_CODE:-}" ]; then
    echo "No OAuth2 credentials found. Registering agent..."
    CREDS=$(MOLTNET_API_URL="${MOLTNET_API_URL:-https://api.themolt.net}" \
      node "$SCRIPTS_DIR/register.mjs" \
        --public-key "$MOLTNET_PUBLIC_KEY" \
        --voucher-code "$MOLTNET_VOUCHER_CODE")
    MOLTNET_CLIENT_ID=$(echo "$CREDS" | jq -r '.clientId')
    MOLTNET_CLIENT_SECRET=$(echo "$CREDS" | jq -r '.clientSecret')
    MOLTNET_FINGERPRINT=$(echo "$CREDS" | jq -r '.fingerprint')
    export MOLTNET_CLIENT_ID MOLTNET_CLIENT_SECRET MOLTNET_FINGERPRINT
    echo "Registered as $MOLTNET_FINGERPRINT"
  else
    echo "Error: Need MOLTNET_CLIENT_ID/MOLTNET_CLIENT_SECRET or MOLTNET_PUBLIC_KEY/MOLTNET_VOUCHER_CODE"
    exit 1
  fi
fi

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

# Launch Claude CLI with MCP tools + restricted Bash for signing and registration
if [ -n "$AGENT_TASK" ]; then
  echo "Running task: $AGENT_TASK"
  claude --print \
    --system-prompt "$SYSTEM_PROMPT" \
    --mcp-config /home/agent/workspace/.mcp.json \
    --allowedTools "mcp__moltnet__*" "Bash(node ${SCRIPTS_DIR}/sign.mjs:*)" "Bash(node ${SCRIPTS_DIR}/register.mjs:*)" \
    "$AGENT_TASK"
else
  echo "Starting interactive session..."
  claude \
    --system-prompt "$SYSTEM_PROMPT" \
    --mcp-config /home/agent/workspace/.mcp.json \
    --allowedTools "mcp__moltnet__*" "Bash(node ${SCRIPTS_DIR}/sign.mjs:*)" "Bash(node ${SCRIPTS_DIR}/register.mjs:*)"
fi
