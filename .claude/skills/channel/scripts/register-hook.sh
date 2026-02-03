#!/usr/bin/env bash
set -euo pipefail

# register-hook.sh — SessionStart hook for automatic channel registration
#
# Runs at session start to register the session in the channel.
# Receives hook JSON on stdin with session_id.
#
# Hook integration (add to .claude/settings.local.json):
#   "SessionStart": [{
#     "hooks": [{
#       "type": "command",
#       "command": ".claude/skills/channel/scripts/register-hook.sh"
#     }]
#   }]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHANNEL_SH="$SCRIPT_DIR/channel.sh"
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$SCRIPT_DIR/../../../.." && pwd)}"
CHANNEL_DIR="${MOLT_CHANNEL_DIR:-$PROJECT_DIR/.molt-channel}"

# Exit silently if channel not initialized (user hasn't opted in yet)
[[ -d "$CHANNEL_DIR/channels" ]] || exit 0

# Parse session_id from hook JSON input
INPUT=""
if [[ ! -t 0 ]]; then
  INPUT=$(cat)
fi

SESSION_ID=""
if [[ -n "$INPUT" ]]; then
  SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty' 2>/dev/null || true)
fi
SESSION_ID="${SESSION_ID:-${CLAUDE_SESSION_ID:-}}"
[[ -z "$SESSION_ID" ]] && exit 0

# Check if already registered
EXISTING=$(jq -r --arg id "$SESSION_ID" '.sessions[$id] // empty' "$CHANNEL_DIR/registry.json" 2>/dev/null || true)
if [[ -n "$EXISTING" ]]; then
  # Just update heartbeat
  "$CHANNEL_SH" heartbeat "$SESSION_ID" &>/dev/null || true
  # Inject context about active sessions
  SESSIONS=$("$CHANNEL_SH" sessions 2>/dev/null || true)
  POLL=$("$CHANNEL_SH" poll "$SESSION_ID" 2>/dev/null || echo '{"has_new":false,"count":0}')
  HAS_NEW=$(echo "$POLL" | jq -r '.has_new' 2>/dev/null || echo "false")
  MSG_COUNT=$(echo "$POLL" | jq -r '.count' 2>/dev/null || echo "0")

  if [[ "$HAS_NEW" == "true" ]]; then
    echo "[Channel] Session resumed. $MSG_COUNT unread message(s). Use /channel to check."
  fi
  exit 0
fi

# Auto-register with a generated name
SHORT_ID="${SESSION_ID:0:8}"
NAME="claude-$SHORT_ID"

"$CHANNEL_SH" register "$SESSION_ID" "$NAME" &>/dev/null || true

# Report channel status
SESSIONS=$("$CHANNEL_SH" sessions 2>/dev/null || true)
SESSION_COUNT=$(jq '.sessions | length' "$CHANNEL_DIR/registry.json" 2>/dev/null || echo "0")

if [[ "$SESSION_COUNT" -gt 1 ]]; then
  echo "[Channel] Registered as $NAME. $SESSION_COUNT session(s) active. Use /channel to communicate."
fi
