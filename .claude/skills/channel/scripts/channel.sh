#!/usr/bin/env bash
set -euo pipefail

# channel.sh — Inter-session communication via shared file channels
# Part of MoltNet preparation: file-based message passing between Claude sessions
#
# Usage: channel.sh <command> [args...]
#
# Commands:
#   init                                     Create channel directory
#   register <session_id> <name>             Register a session
#   deregister <session_id>                  Remove a session
#   send <channel> <session_id> <message>    Send to channel
#   direct <session_id> <target_id> <msg>    Send direct message
#   receive <session_id> [--mark-read]       Read new messages
#   poll <session_id>                        Quick check (JSON output for hooks)
#   sessions                                 List active sessions
#   channels                                 List available channels
#   heartbeat <session_id>                   Update heartbeat timestamp
#   prune [--older-than <hours>]             Remove old messages
#   gc                                       Remove stale sessions (no heartbeat >30m)

CHANNEL_DIR="${MOLT_CHANNEL_DIR:-${CLAUDE_PROJECT_DIR:-.}/.molt-channel}"
LOCK_TIMEOUT=5
STALE_THRESHOLD_SECONDS=1800  # 30 minutes
DEFAULT_CHANNEL="general"

# --- Helpers ---

ensure_dir() {
  if [[ ! -d "$CHANNEL_DIR" ]]; then
    echo "error: Channel not initialized. Run 'channel.sh init' first." >&2
    exit 1
  fi
}

registry_file() {
  echo "$CHANNEL_DIR/registry.json"
}

# Atomic registry update with file locking
# Usage: with_registry <jq_filter> [jq_args...]
with_registry() {
  local filter="$1"
  shift
  local reg
  reg=$(registry_file)
  (
    flock -w "$LOCK_TIMEOUT" 200 || { echo "error: Failed to acquire registry lock" >&2; exit 1; }
    local current
    current=$(cat "$reg")
    local updated
    updated=$(echo "$current" | jq "$@" "$filter")
    # Atomic write: temp file + mv
    echo "$updated" > "$reg.tmp"
    mv "$reg.tmp" "$reg"
  ) 200>"$CHANNEL_DIR/.registry.lock"
}

read_registry() {
  ensure_dir
  cat "$(registry_file)"
}

epoch_ms() {
  # Portable millisecond timestamp
  if date +%s%3N &>/dev/null && [[ $(date +%s%3N) != *N* ]]; then
    date +%s%3N
  else
    echo "$(date +%s)000"
  fi
}

generate_id() {
  # Generate a unique message ID
  if command -v uuidgen &>/dev/null; then
    uuidgen | tr '[:upper:]' '[:lower:]'
  elif [[ -f /proc/sys/kernel/random/uuid ]]; then
    cat /proc/sys/kernel/random/uuid
  else
    echo "$(epoch_ms)-$(head -c 8 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  fi
}

session_name() {
  local session_id="$1"
  ensure_dir
  jq -r --arg id "$session_id" '.sessions[$id].name // "unknown"' "$(registry_file)"
}

watermark_file() {
  local session_id="$1"
  echo "$CHANNEL_DIR/.watermarks/$session_id"
}

now_iso() {
  date -u +%Y-%m-%dT%H:%M:%SZ
}

# --- Commands ---

cmd_init() {
  if [[ -d "$CHANNEL_DIR/channels" ]]; then
    echo "Channel directory already exists at $CHANNEL_DIR"
    return 0
  fi

  mkdir -p "$CHANNEL_DIR"/{channels/"$DEFAULT_CHANNEL",.watermarks}
  echo '{"sessions":{}}' > "$CHANNEL_DIR/registry.json"

  # Create a .gitignore inside the channel dir
  # The channel data is local by default; opt-in to git tracking
  cat > "$CHANNEL_DIR/.gitignore" << 'GITIGNORE'
# Channel data is local by default
# Remove specific lines to track in git
*.lock
.watermarks/
GITIGNORE

  echo "Channel initialized at $CHANNEL_DIR"
  echo "Default channel: $DEFAULT_CHANNEL"
}

cmd_register() {
  local session_id="${1:?Usage: register <session_id> <name>}"
  local name="${2:?Usage: register <session_id> <name>}"
  ensure_dir

  local ts
  ts=$(now_iso)
  local short_id="${session_id:0:8}"

  with_registry \
    '.sessions[$id] = {
      "name": $name,
      "short_id": $short_id,
      "registered_at": $ts,
      "last_heartbeat": $ts,
      "status": "active"
    }' \
    --arg id "$session_id" \
    --arg name "$name" \
    --arg short_id "$short_id" \
    --arg ts "$ts"

  # Initialize watermark
  mkdir -p "$CHANNEL_DIR/.watermarks"
  touch "$(watermark_file "$session_id")"

  echo "Registered as \"$name\" ($short_id)"
}

cmd_deregister() {
  local session_id="${1:?Usage: deregister <session_id>}"
  ensure_dir

  with_registry \
    'del(.sessions[$id])' \
    --arg id "$session_id"

  # Clean up watermark
  rm -f "$(watermark_file "$session_id")"

  echo "Session ${session_id:0:8} deregistered"
}

cmd_send() {
  local channel="${1:?Usage: send <channel> <session_id> <message>}"
  local session_id="${2:?Usage: send <channel> <session_id> <message>}"
  local message="${3:?Usage: send <channel> <session_id> <message>}"
  ensure_dir

  local ts
  ts=$(epoch_ms)
  local short_id="${session_id:0:8}"
  local name
  name=$(session_name "$session_id")
  local msg_id
  msg_id=$(generate_id)
  local msg_dir="$CHANNEL_DIR/channels/$channel"

  mkdir -p "$msg_dir"

  local msg_file="$msg_dir/${ts}-${short_id}.json"
  local content_escaped
  content_escaped=$(printf '%s' "$message" | jq -Rs .)

  cat > "$msg_file" << EOF
{
  "id": "$msg_id",
  "from": {
    "session_id": "$session_id",
    "name": "$name",
    "short_id": "$short_id"
  },
  "to": "broadcast",
  "channel": "$channel",
  "type": "message",
  "content": $content_escaped,
  "timestamp": "$(now_iso)"
}
EOF

  echo "Sent to #$channel"
}

cmd_direct() {
  local session_id="${1:?Usage: direct <session_id> <target_id> <message>}"
  local target_id="${2:?Usage: direct <session_id> <target_id> <message>}"
  local message="${3:?Usage: direct <session_id> <target_id> <message>}"
  ensure_dir

  local ts
  ts=$(epoch_ms)
  local short_id="${session_id:0:8}"
  local name
  name=$(session_name "$session_id")
  local msg_id
  msg_id=$(generate_id)

  # Direct messages go to a directory named for the target
  local msg_dir="$CHANNEL_DIR/channels/.direct-${target_id:0:8}"
  mkdir -p "$msg_dir"

  local msg_file="$msg_dir/${ts}-${short_id}.json"
  local content_escaped
  content_escaped=$(printf '%s' "$message" | jq -Rs .)

  cat > "$msg_file" << EOF
{
  "id": "$msg_id",
  "from": {
    "session_id": "$session_id",
    "name": "$name",
    "short_id": "$short_id"
  },
  "to": "$target_id",
  "channel": "direct",
  "type": "message",
  "content": $content_escaped,
  "timestamp": "$(now_iso)"
}
EOF

  echo "Direct message sent to ${target_id:0:8}"
}

cmd_receive() {
  local session_id="${1:?Usage: receive <session_id> [--mark-read]}"
  shift
  local mark_read=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --mark-read) mark_read=1; shift ;;
      *) shift ;;
    esac
  done
  ensure_dir

  local wm_file
  wm_file=$(watermark_file "$session_id")
  local short_id="${session_id:0:8}"

  # Collect message directories to scan: all channels + direct messages for us
  local -a scan_dirs=()
  # Regular channels (non-hidden)
  for dir in "$CHANNEL_DIR"/channels/*/; do
    [[ -d "$dir" ]] || continue
    scan_dirs+=("$dir")
  done
  # Direct message directory for this session (hidden/dotfile)
  if [[ -d "$CHANNEL_DIR/channels/.direct-$short_id" ]]; then
    scan_dirs+=("$CHANNEL_DIR/channels/.direct-$short_id/")
  fi

  if [[ ${#scan_dirs[@]} -eq 0 ]]; then
    echo "No channels found"
    return
  fi

  # Find new messages
  local -a new_msgs=()
  for dir in "${scan_dirs[@]}"; do
    if [[ -f "$wm_file" ]]; then
      while IFS= read -r f; do
        # Skip own messages
        local fname
        fname=$(basename "$f")
        [[ "$fname" == *"-${short_id}.json" ]] && continue
        new_msgs+=("$f")
      done < <(find "$dir" -name "*.json" -newer "$wm_file" -type f 2>/dev/null | sort)
    else
      while IFS= read -r f; do
        local fname
        fname=$(basename "$f")
        [[ "$fname" == *"-${short_id}.json" ]] && continue
        new_msgs+=("$f")
      done < <(find "$dir" -name "*.json" -type f 2>/dev/null | sort)
    fi
  done

  if [[ ${#new_msgs[@]} -eq 0 ]]; then
    echo '{"count":0,"messages":[]}'
    return
  fi

  # Build JSON array of messages
  local json_msgs="["
  local first=1
  for msg_file in "${new_msgs[@]}"; do
    [[ -f "$msg_file" ]] || continue
    if [[ $first -eq 1 ]]; then
      first=0
    else
      json_msgs+=","
    fi
    json_msgs+=$(cat "$msg_file")
  done
  json_msgs+="]"

  # Output structured result
  echo "{\"count\":${#new_msgs[@]},\"messages\":$json_msgs}" | jq .

  # Update watermark if requested
  if [[ -n "$mark_read" ]]; then
    mkdir -p "$CHANNEL_DIR/.watermarks"
    touch "$wm_file"
  fi
}

cmd_poll() {
  # Lightweight check: are there new messages? Returns minimal JSON.
  # Designed for hook consumption — fast exit if nothing new.
  local session_id="${1:?Usage: poll <session_id>}"
  ensure_dir

  local wm_file
  wm_file=$(watermark_file "$session_id")
  local short_id="${session_id:0:8}"

  # No watermark = first poll
  if [[ ! -f "$wm_file" ]]; then
    mkdir -p "$CHANNEL_DIR/.watermarks"
    touch "$wm_file"
    echo '{"has_new":false,"count":0}'
    return
  fi

  # Quick scan: any files newer than watermark?
  local count=0
  local -a poll_dirs=()
  for dir in "$CHANNEL_DIR"/channels/*/; do
    [[ -d "$dir" ]] || continue
    poll_dirs+=("$dir")
  done
  if [[ -d "$CHANNEL_DIR/channels/.direct-$short_id" ]]; then
    poll_dirs+=("$CHANNEL_DIR/channels/.direct-$short_id/")
  fi
  for dir in "${poll_dirs[@]}"; do
    local found
    found=$(find "$dir" -name "*.json" -newer "$wm_file" -type f ! -name "*-${short_id}.json" 2>/dev/null | head -20)
    if [[ -n "$found" ]]; then
      count=$((count + $(echo "$found" | wc -l)))
    fi
  done

  if [[ $count -eq 0 ]]; then
    echo '{"has_new":false,"count":0}'
  else
    echo "{\"has_new\":true,\"count\":$count}"
  fi
}

cmd_sessions() {
  ensure_dir
  local registry
  registry=$(read_registry)

  local session_count
  session_count=$(echo "$registry" | jq '.sessions | length')

  if [[ "$session_count" -eq 0 ]]; then
    echo "No active sessions"
    return
  fi

  echo "$registry" | jq -r '
    .sessions | to_entries[] |
    "  \(.value.name) (\(.value.short_id)) — \(.value.status) since \(.value.registered_at), heartbeat \(.value.last_heartbeat)"
  '
}

cmd_channels() {
  ensure_dir
  echo "Channels:"
  for dir in "$CHANNEL_DIR"/channels/*/; do
    [[ -d "$dir" ]] || continue
    local name
    name=$(basename "$dir")
    [[ "$name" == .direct-* ]] && continue
    local count
    count=$(find "$dir" -name "*.json" -type f 2>/dev/null | wc -l)
    echo "  #$name ($count messages)"
  done
}

cmd_heartbeat() {
  local session_id="${1:?Usage: heartbeat <session_id>}"
  ensure_dir

  local ts
  ts=$(now_iso)

  with_registry \
    'if .sessions[$id] then .sessions[$id].last_heartbeat = $ts else . end' \
    --arg id "$session_id" \
    --arg ts "$ts"
}

cmd_prune() {
  local older_than_hours=24
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --older-than) older_than_hours="$2"; shift 2 ;;
      *) shift ;;
    esac
  done
  ensure_dir

  local older_than_minutes=$((older_than_hours * 60))
  local count
  count=$(find "$CHANNEL_DIR/channels" -name "*.json" -type f -mmin +"$older_than_minutes" 2>/dev/null | wc -l)

  if [[ "$count" -eq 0 ]]; then
    echo "No messages older than ${older_than_hours}h"
    return
  fi

  find "$CHANNEL_DIR/channels" -name "*.json" -type f -mmin +"$older_than_minutes" -delete 2>/dev/null
  echo "Pruned $count messages older than ${older_than_hours}h"
}

cmd_gc() {
  # Remove sessions with stale heartbeats
  ensure_dir
  local now_epoch
  now_epoch=$(date +%s)
  local registry
  registry=$(read_registry)

  local stale_ids
  stale_ids=$(echo "$registry" | jq -r --argjson threshold "$STALE_THRESHOLD_SECONDS" --arg now "$now_epoch" '
    .sessions | to_entries[] |
    select(
      (.value.last_heartbeat | sub("\\.[0-9]+Z$"; "Z") |
       strptime("%Y-%m-%dT%H:%M:%SZ") | mktime) < (($now | tonumber) - $threshold)
    ) | .key
  ' 2>/dev/null || true)

  if [[ -z "$stale_ids" ]]; then
    echo "No stale sessions"
    return
  fi

  while IFS= read -r sid; do
    [[ -z "$sid" ]] && continue
    with_registry 'del(.sessions[$id])' --arg id "$sid"
    rm -f "$(watermark_file "$sid")"
    echo "Removed stale session: ${sid:0:8}"
  done <<< "$stale_ids"
}

# --- Main dispatch ---

cmd="${1:-help}"
shift || true

case "$cmd" in
  init)        cmd_init "$@" ;;
  register)    cmd_register "$@" ;;
  deregister)  cmd_deregister "$@" ;;
  send)        cmd_send "$@" ;;
  direct)      cmd_direct "$@" ;;
  receive)     cmd_receive "$@" ;;
  poll)        cmd_poll "$@" ;;
  sessions)    cmd_sessions "$@" ;;
  channels)    cmd_channels "$@" ;;
  heartbeat)   cmd_heartbeat "$@" ;;
  prune)       cmd_prune "$@" ;;
  gc)          cmd_gc "$@" ;;
  help|--help|-h)
    echo "Usage: channel.sh <command> [args...]"
    echo ""
    echo "Commands:"
    echo "  init                                     Create channel directory"
    echo "  register <session_id> <name>             Register a session"
    echo "  deregister <session_id>                  Remove a session"
    echo "  send <channel> <session_id> <message>    Send to channel"
    echo "  direct <session_id> <target_id> <msg>    Send direct message"
    echo "  receive <session_id> [--mark-read]       Read new messages"
    echo "  poll <session_id>                        Quick check for hooks"
    echo "  sessions                                 List active sessions"
    echo "  channels                                 List available channels"
    echo "  heartbeat <session_id>                   Update heartbeat"
    echo "  prune [--older-than <hours>]             Remove old messages"
    echo "  gc                                       Remove stale sessions"
    ;;
  *)
    echo "error: Unknown command '$cmd'. Run 'channel.sh help' for usage." >&2
    exit 1
    ;;
esac
