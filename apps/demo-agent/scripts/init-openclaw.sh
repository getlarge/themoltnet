#!/usr/bin/env bash
set -euo pipefail

# init-openclaw.sh — Configure MoltNet for an existing OpenClaw install
#
# Usage:
#   ./init-openclaw.sh [--credentials <path>]
#
# Options:
#   --credentials <path>  Path to credentials JSON (default: demo/credentials.json)
#
# The script:
#   1. Detects OpenClaw config directory
#   2. Reads or prompts for MoltNet credentials
#   3. Merges MCP server config into openclaw.json
#   4. Installs the MoltNet skill
#   5. Writes the Ed25519 private key
#   6. Validates the setup

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SKILL_SRC="${PROJECT_ROOT}/packages/openclaw-skill/SKILL.md"

CREDENTIALS_FILE="${PROJECT_ROOT}/demo/credentials.json"
AGENT_INDEX=0

# --- Parse arguments ---

while [[ $# -gt 0 ]]; do
  case "$1" in
    --credentials)
      CREDENTIALS_FILE="$2"
      shift 2
      ;;
    --agent-index)
      AGENT_INDEX="$2"
      shift 2
      ;;
    -h|--help)
      echo "Usage: $0 [--credentials <path>] [--agent-index <n>]"
      echo ""
      echo "Options:"
      echo "  --credentials <path>  Path to credentials JSON (default: demo/credentials.json)"
      echo "  --agent-index <n>     Index in credentials array (default: 0)"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# --- Detect OpenClaw config directory ---

detect_config_dir() {
  if [ -d "/data" ] && [ -f "/data/openclaw.json" ]; then
    echo "/data"
  elif [ -d "${HOME}/.openclaw" ]; then
    echo "${HOME}/.openclaw"
  else
    echo ""
  fi
}

CONFIG_DIR="$(detect_config_dir)"

if [ -z "$CONFIG_DIR" ]; then
  echo "ERROR: Could not find OpenClaw config directory."
  echo "Expected ~/.openclaw/ or /data/ (Fly.io)."
  echo "Install OpenClaw first: https://docs.openclaw.ai/install/docker"
  exit 1
fi

echo "Found OpenClaw config at: ${CONFIG_DIR}"

CONFIG_FILE="${CONFIG_DIR}/openclaw.json"
SKILLS_DIR="${CONFIG_DIR}/skills/moltnet"
KEY_FILE="${CONFIG_DIR}/moltnet-key.pem"

# --- Check dependencies ---

if ! command -v jq &>/dev/null; then
  echo "ERROR: jq is required but not installed."
  echo "Install it: brew install jq (macOS) or apt-get install jq (Linux)"
  exit 1
fi

# --- Read credentials ---

CLIENT_ID=""
CLIENT_SECRET=""
PRIVATE_KEY_B64=""

if [ -f "$CREDENTIALS_FILE" ]; then
  echo "Reading credentials from: ${CREDENTIALS_FILE}"
  CLIENT_ID="$(jq -r ".[${AGENT_INDEX}].clientId" "$CREDENTIALS_FILE")"
  CLIENT_SECRET="$(jq -r ".[${AGENT_INDEX}].clientSecret" "$CREDENTIALS_FILE")"
  PRIVATE_KEY_B64="$(jq -r ".[${AGENT_INDEX}].privateKey" "$CREDENTIALS_FILE")"

  if [ "$CLIENT_ID" = "null" ] || [ -z "$CLIENT_ID" ]; then
    echo "WARNING: Could not read credentials from ${CREDENTIALS_FILE}"
    CLIENT_ID=""
  fi
fi

if [ -z "$CLIENT_ID" ]; then
  echo ""
  echo "Enter MoltNet credentials manually:"
  read -rp "  Client ID: " CLIENT_ID
  read -rp "  Client Secret: " CLIENT_SECRET
  read -rp "  Private Key (base64): " PRIVATE_KEY_B64
fi

if [ -z "$CLIENT_ID" ] || [ -z "$CLIENT_SECRET" ]; then
  echo "ERROR: Client ID and Client Secret are required."
  exit 1
fi

echo ""
echo "Using Client ID: ${CLIENT_ID:0:8}..."

# --- Merge MCP server config ---

echo "Configuring MCP server in ${CONFIG_FILE}..."

MCP_CONFIG=$(cat <<MCPEOF
{
  "url": "https://api.themolt.net/mcp",
  "headers": {
    "X-Client-Id": "${CLIENT_ID}",
    "X-Client-Secret": "${CLIENT_SECRET}"
  }
}
MCPEOF
)

if [ -f "$CONFIG_FILE" ]; then
  # Merge into existing config
  TEMP_FILE="$(mktemp)"
  jq --argjson moltnet "$MCP_CONFIG" \
    '.mcpServers.moltnet = $moltnet' \
    "$CONFIG_FILE" > "$TEMP_FILE"
  mv "$TEMP_FILE" "$CONFIG_FILE"
else
  # Create new config
  jq -n --argjson moltnet "$MCP_CONFIG" \
    '{ mcpServers: { moltnet: $moltnet } }' \
    > "$CONFIG_FILE"
fi

echo "  MCP server configured."

# --- Install skill ---

echo "Installing MoltNet skill..."

mkdir -p "$SKILLS_DIR"

if [ -f "$SKILL_SRC" ]; then
  cp "$SKILL_SRC" "${SKILLS_DIR}/SKILL.md"
  echo "  Skill installed from ${SKILL_SRC}"
else
  echo "  WARNING: SKILL.md not found at ${SKILL_SRC}"
  echo "  Copy it manually: cp packages/openclaw-skill/SKILL.md ${SKILLS_DIR}/"
fi

# Add skill config to openclaw.json
SKILL_CONFIG=$(cat <<SKILLEOF
{
  "enabled": true,
  "env": {
    "MOLTNET_PRIVATE_KEY_PATH": "${KEY_FILE}"
  }
}
SKILLEOF
)

TEMP_FILE="$(mktemp)"
jq --argjson skill "$SKILL_CONFIG" \
  '.skills.entries.moltnet = $skill' \
  "$CONFIG_FILE" > "$TEMP_FILE"
mv "$TEMP_FILE" "$CONFIG_FILE"

echo "  Skill config added."

# --- Write private key ---

if [ -n "$PRIVATE_KEY_B64" ] && [ "$PRIVATE_KEY_B64" != "null" ]; then
  echo "Writing private key to ${KEY_FILE}..."
  echo "$PRIVATE_KEY_B64" | base64 -d > "$KEY_FILE"
  chmod 600 "$KEY_FILE"
  echo "  Private key written (mode 600)."
else
  echo "WARNING: No private key provided. Signing will not work."
  echo "  Write it later: echo '<base64-key>' | base64 -d > ${KEY_FILE}"
fi

# --- Validate ---

echo ""
echo "Setup complete."
echo ""
echo "Config file:  ${CONFIG_FILE}"
echo "Skill:        ${SKILLS_DIR}/SKILL.md"
echo "Private key:  ${KEY_FILE}"
echo ""

if command -v openclaw &>/dev/null; then
  echo "Validating with 'openclaw tools list'..."
  if openclaw tools list 2>/dev/null | grep -q "moltnet"; then
    echo "  MoltNet tools detected."
  else
    echo "  WARNING: MoltNet tools not found. Restart OpenClaw and try again."
  fi
else
  echo "Restart OpenClaw to pick up the new config."
  echo "Then verify: openclaw tools list"
fi
