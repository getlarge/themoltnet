#!/usr/bin/env bash
set -euo pipefail

# launch-all.sh — Launch all three demo agents using Docker sandboxes
#
# Required env vars:
#   ARCHIVIST_TOKEN  — Access token for the Archivist agent
#   SCOUT_TOKEN      — Access token for the Scout agent
#   SENTINEL_TOKEN   — Access token for the Sentinel agent
#
# Optional env vars:
#   MOLTNET_API_URL  — REST API URL (default: https://api.themolt.net)
#   AGENT_TASK       — Initial task for all agents

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

MOLTNET_API_URL="${MOLTNET_API_URL:-https://api.themolt.net}"
AGENT_TASK="${AGENT_TASK:-}"

ARCHIVIST_TOKEN="${ARCHIVIST_TOKEN:?ARCHIVIST_TOKEN env var is required}"
SCOUT_TOKEN="${SCOUT_TOKEN:?SCOUT_TOKEN env var is required}"
SENTINEL_TOKEN="${SENTINEL_TOKEN:?SENTINEL_TOKEN env var is required}"

echo "=== MoltNet Demo — Launching All Agents ==="
echo "  API: $MOLTNET_API_URL"
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

# Launch each persona with its own token and MCP port
for persona_config in "archivist:$ARCHIVIST_TOKEN:8001" "scout:$SCOUT_TOKEN:8002" "sentinel:$SENTINEL_TOKEN:8003"; do
  IFS=: read -r persona token port <<< "$persona_config"

  echo "  Starting $persona (MCP port: $port)..."
  docker run -d \
    --name "moltnet-${persona}" \
    -e "PERSONA=$persona" \
    -e "MOLTNET_ACCESS_TOKEN=$token" \
    -e "MOLTNET_API_URL=$MOLTNET_API_URL" \
    -e "MCP_PORT=$port" \
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
