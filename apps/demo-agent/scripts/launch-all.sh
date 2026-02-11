#!/usr/bin/env bash
set -euo pipefail

# launch-all.sh — Launch all three demo agents using Docker sandboxes
#
# Required env vars:
#   ARCHIVIST_CLIENT_ID      — OAuth2 client ID for the Archivist agent
#   ARCHIVIST_CLIENT_SECRET  — OAuth2 client secret for the Archivist agent
#   SCOUT_CLIENT_ID          — OAuth2 client ID for the Scout agent
#   SCOUT_CLIENT_SECRET      — OAuth2 client secret for the Scout agent
#   SENTINEL_CLIENT_ID       — OAuth2 client ID for the Sentinel agent
#   SENTINEL_CLIENT_SECRET   — OAuth2 client secret for the Sentinel agent
#
# Optional env vars:
#   ARCHIVIST_PRIVATE_KEY    — Ed25519 private key (base64) for signing
#   SCOUT_PRIVATE_KEY        — Ed25519 private key (base64) for signing
#   SENTINEL_PRIVATE_KEY     — Ed25519 private key (base64) for signing
#   MOLTNET_MCP_URL          — MCP server URL (default: https://mcp.themolt.net/mcp)
#   AGENT_TASK               — Initial task for all agents

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

MOLTNET_MCP_URL="${MOLTNET_MCP_URL:-https://mcp.themolt.net/mcp}"
AGENT_TASK="${AGENT_TASK:-}"

ARCHIVIST_CLIENT_ID="${ARCHIVIST_CLIENT_ID:?ARCHIVIST_CLIENT_ID env var is required}"
ARCHIVIST_CLIENT_SECRET="${ARCHIVIST_CLIENT_SECRET:?ARCHIVIST_CLIENT_SECRET env var is required}"
SCOUT_CLIENT_ID="${SCOUT_CLIENT_ID:?SCOUT_CLIENT_ID env var is required}"
SCOUT_CLIENT_SECRET="${SCOUT_CLIENT_SECRET:?SCOUT_CLIENT_SECRET env var is required}"
SENTINEL_CLIENT_ID="${SENTINEL_CLIENT_ID:?SENTINEL_CLIENT_ID env var is required}"
SENTINEL_CLIENT_SECRET="${SENTINEL_CLIENT_SECRET:?SENTINEL_CLIENT_SECRET env var is required}"

echo "=== MoltNet Demo — Launching All Agents ==="
echo "  MCP: $MOLTNET_MCP_URL"
echo ""

# Build the demo-agent image if not already built
IMAGE_NAME="moltnet/demo-agent"
echo "Building demo agent image..."
docker build \
  -t "$IMAGE_NAME" \
  -f "$PROJECT_ROOT/apps/demo-agent/Dockerfile" \
  "$PROJECT_ROOT"

echo ""
echo "Launching agents..."

# Launch each persona with its own credentials
declare -A CLIENT_IDS=(
  [archivist]="$ARCHIVIST_CLIENT_ID"
  [scout]="$SCOUT_CLIENT_ID"
  [sentinel]="$SENTINEL_CLIENT_ID"
)
declare -A CLIENT_SECRETS=(
  [archivist]="$ARCHIVIST_CLIENT_SECRET"
  [scout]="$SCOUT_CLIENT_SECRET"
  [sentinel]="$SENTINEL_CLIENT_SECRET"
)
declare -A PRIVATE_KEYS=(
  [archivist]="${ARCHIVIST_PRIVATE_KEY:-}"
  [scout]="${SCOUT_PRIVATE_KEY:-}"
  [sentinel]="${SENTINEL_PRIVATE_KEY:-}"
)

for persona in archivist scout sentinel; do
  echo "  Starting $persona..."
  docker run -d \
    --name "moltnet-${persona}" \
    -e "PERSONA=$persona" \
    -e "MOLTNET_CLIENT_ID=${CLIENT_IDS[$persona]}" \
    -e "MOLTNET_CLIENT_SECRET=${CLIENT_SECRETS[$persona]}" \
    -e "MOLTNET_PRIVATE_KEY=${PRIVATE_KEYS[$persona]}" \
    -e "MOLTNET_MCP_URL=$MOLTNET_MCP_URL" \
    -e "AGENT_TASK=${AGENT_TASK}" \
    "$IMAGE_NAME"
done

echo ""
echo "All agents launched. Use 'docker logs -f moltnet-<persona>' to follow."
echo "  docker logs -f moltnet-archivist"
echo "  docker logs -f moltnet-scout"
echo "  docker logs -f moltnet-sentinel"
echo ""
echo "To stop all agents:"
echo "  docker stop moltnet-archivist moltnet-scout moltnet-sentinel"
echo "  docker rm moltnet-archivist moltnet-scout moltnet-sentinel"
