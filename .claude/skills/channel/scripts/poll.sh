#!/usr/bin/env bash
set -euo pipefail

# poll.sh — Lightweight message poll for Claude Code hooks
#
# Designed to run as a PostToolUse async hook. Receives hook JSON on stdin,
# checks for new messages, and outputs context for Claude if any are found.
#
# Hook integration (add to .claude/settings.local.json):
#   "PostToolUse": [{
#     "matcher": ".*",
#     "hooks": [{
#       "type": "command",
#       "command": ".claude/skills/channel/scripts/poll.sh",
#       "async": true,
#       "timeout": 10
#     }]
#   }]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHANNEL_SH="$SCRIPT_DIR/channel.sh"
# Resolve project dir: MOLT_CHANNEL_DIR > CLAUDE_PROJECT_DIR > script-relative
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$SCRIPT_DIR/../../../.." && pwd)}"
CHANNEL_DIR="${MOLT_CHANNEL_DIR:-$PROJECT_DIR/.molt-channel}"

# Exit fast if no channel directory
[[ -d "$CHANNEL_DIR/channels" ]] || exit 0

# Parse session_id from hook JSON input (stdin)
INPUT=""
if [[ ! -t 0 ]]; then
  INPUT=$(cat)
fi

SESSION_ID=""
if [[ -n "$INPUT" ]]; then
  SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty' 2>/dev/null || true)
fi

# Fallback to env var
SESSION_ID="${SESSION_ID:-${CLAUDE_SESSION_ID:-}}"

# No session ID = can't poll
[[ -z "$SESSION_ID" ]] && exit 0

# Check if this session is registered
REGISTERED=$(jq -r --arg id "$SESSION_ID" '.sessions[$id] // empty' "$CHANNEL_DIR/registry.json" 2>/dev/null || true)
[[ -z "$REGISTERED" ]] && exit 0

# Quick poll check
POLL_RESULT=$("$CHANNEL_SH" poll "$SESSION_ID" 2>/dev/null || echo '{"has_new":false}')
HAS_NEW=$(echo "$POLL_RESULT" | jq -r '.has_new' 2>/dev/null || echo "false")

[[ "$HAS_NEW" != "true" ]] && exit 0

# New messages found — read them
MSG_COUNT=$(echo "$POLL_RESULT" | jq -r '.count' 2>/dev/null || echo "0")
MESSAGES=$("$CHANNEL_SH" receive "$SESSION_ID" --mark-read 2>/dev/null || true)

# Format output for Claude's context
if [[ -n "$MESSAGES" ]] && [[ "$MESSAGES" != '{"count":0,"messages":[]}' ]]; then
  echo ""
  echo "[Channel] $MSG_COUNT new message(s):"
  echo "$MESSAGES" | jq -r '
    .messages[]? |
    "  [\(.channel)] \(.from.name) (\(.from.short_id)): \(.content)"
  ' 2>/dev/null || echo "$MESSAGES"
  echo ""
  echo "Use /channel to respond or check full history."
fi

# Update heartbeat while we're at it
"$CHANNEL_SH" heartbeat "$SESSION_ID" &>/dev/null || true
