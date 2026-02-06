#!/usr/bin/env bash
set -euo pipefail

# Agent Sync — Polls GitHub Projects and returns context for Claude Code hooks.
#
# Called by Claude Code hooks (SessionStart, Stop, Notification).
# Reads JSON from stdin (hook context), writes JSON to stdout.
#
# Usage:
#   echo '{}' | ./scripts/agent-sync.sh session-start
#   echo '{}' | ./scripts/agent-sync.sh on-stop
#   echo '{"notification_type":"idle_prompt"}' | ./scripts/agent-sync.sh on-idle
#
# Environment:
#   MOLTNET_PROJECT_NUMBER  — GitHub Project number (required)
#   MOLTNET_PROJECT_OWNER   — GitHub org/user (default: getlarge)

ACTION="${1:?Usage: agent-sync.sh <session-start|on-stop|on-idle>}"

PROJECT_NUMBER="${MOLTNET_PROJECT_NUMBER:-}"
PROJECT_OWNER="${MOLTNET_PROJECT_OWNER:-getlarge}"

# Read hook input from stdin (Claude Code sends JSON context)
HOOK_INPUT=$(cat)

# --- Bail early if preconditions not met ---

if ! command -v gh &>/dev/null; then
  echo '{"additionalContext": "GitHub CLI not available. Skipping project sync."}'
  exit 0
fi

if [ -z "$PROJECT_NUMBER" ]; then
  echo '{"additionalContext": "MOLTNET_PROJECT_NUMBER not set. Skipping project sync."}'
  exit 0
fi

if ! gh project view "$PROJECT_NUMBER" --owner "$PROJECT_OWNER" --format json &>/dev/null; then
  echo '{"additionalContext": "Cannot access project #'"$PROJECT_NUMBER"'. Check gh auth (needs project scope)."}'
  exit 0
fi

# --- Helpers ---

fetch_items() {
  gh project item-list "$PROJECT_NUMBER" \
    --owner "$PROJECT_OWNER" \
    --format json 2>/dev/null || echo '{"items":[]}'
}

fetch_fields() {
  gh project field-list "$PROJECT_NUMBER" \
    --owner "$PROJECT_OWNER" \
    --format json 2>/dev/null || echo '{"fields":[]}'
}

update_item_field() {
  local item_id="$1"
  local field_name="$2"
  local option_name="$3"

  local project_id
  project_id=$(gh project view "$PROJECT_NUMBER" --owner "$PROJECT_OWNER" --format json | jq -r '.id')

  local fields
  fields=$(fetch_fields)

  local field_id
  field_id=$(echo "$fields" | jq -r --arg name "$field_name" '.fields[] | select(.name == $name) | .id')

  local option_id
  option_id=$(echo "$fields" | jq -r --arg name "$field_name" --arg opt "$option_name" \
    '.fields[] | select(.name == $name) | .options[] | select(.name == $opt) | .id')

  if [ -n "$field_id" ] && [ -n "$option_id" ] && [ "$field_id" != "null" ] && [ "$option_id" != "null" ]; then
    gh project item-edit \
      --id "$item_id" \
      --project-id "$project_id" \
      --field-id "$field_id" \
      --single-select-option-id "$option_id" 2>/dev/null
  fi
}

update_item_text() {
  local item_id="$1"
  local field_name="$2"
  local value="$3"

  local project_id
  project_id=$(gh project view "$PROJECT_NUMBER" --owner "$PROJECT_OWNER" --format json | jq -r '.id')

  local fields
  fields=$(fetch_fields)

  local field_id
  field_id=$(echo "$fields" | jq -r --arg name "$field_name" '.fields[] | select(.name == $name) | .id')

  if [ -n "$field_id" ] && [ "$field_id" != "null" ]; then
    gh project item-edit \
      --id "$item_id" \
      --project-id "$project_id" \
      --field-id "$field_id" \
      --text "$value" 2>/dev/null
  fi
}

# ============================================================
# Actions
# ============================================================

case "$ACTION" in

  session-start)
    ITEMS=$(fetch_items)

    READY_COUNT=$(echo "$ITEMS" | jq '[.items[] | select(.status == "Todo")] | length')
    IN_PROGRESS_COUNT=$(echo "$ITEMS" | jq '[.items[] | select(.status == "In Progress")] | length')
    IN_REVIEW_COUNT=$(echo "$ITEMS" | jq '[.items[] | select(.status == "In Review")] | length')
    DONE_COUNT=$(echo "$ITEMS" | jq '[.items[] | select(.status == "Done")] | length')

    READY_LIST=$(echo "$ITEMS" | jq -r \
      '[.items[] | select(.status == "Todo")] | .[0:5] | .[] | "- \(.title) (#\(.content.number // "?"))"' \
      2>/dev/null || echo "- none")

    IN_PROGRESS_LIST=$(echo "$ITEMS" | jq -r \
      '[.items[] | select(.status == "In Progress")] | .[] | "- \(.title) (agent: \(.agent // "unassigned"))"' \
      2>/dev/null || echo "- none")

    IN_REVIEW_LIST=$(echo "$ITEMS" | jq -r \
      '[.items[] | select(.status == "In Review")] | .[] | "- \(.title) (#\(.content.number // "?"))"' \
      2>/dev/null || echo "- none")

    CONTEXT="GitHub Project Board (#${PROJECT_NUMBER}):
Ready: ${READY_COUNT} items | In Progress: ${IN_PROGRESS_COUNT} | In Review: ${IN_REVIEW_COUNT} | Done: ${DONE_COUNT}

Available tasks (Ready for Agent):
${READY_LIST}

Currently in progress:
${IN_PROGRESS_LIST}

In review:
${IN_REVIEW_LIST}

Use /claim <issue-number> to claim a task. Use /sync for full board state."

    CONTEXT_JSON=$(echo "$CONTEXT" | jq -Rs .)
    echo "{\"additionalContext\": ${CONTEXT_JSON}}"
    ;;

  on-stop)
    # After each Claude response, check if the agent signaled a status change.
    # Convention: agent writes .agent-claim.json with {item_id, status, agent_id}
    CLAIM_FILE="${CLAUDE_PROJECT_DIR:-.}/.agent-claim.json"

    if [ -f "$CLAIM_FILE" ]; then
      ITEM_ID=$(jq -r '.item_id' "$CLAIM_FILE")
      NEW_STATUS=$(jq -r '.status // empty' "$CLAIM_FILE")
      AGENT_ID=$(jq -r '.agent_id // "unknown"' "$CLAIM_FILE")

      if [ -n "$ITEM_ID" ] && [ -n "$NEW_STATUS" ]; then
        update_item_field "$ITEM_ID" "Status" "$NEW_STATUS"
        update_item_text "$ITEM_ID" "Agent" "$AGENT_ID"
      fi

      rm -f "$CLAIM_FILE"
    fi

    exit 0
    ;;

  on-idle)
    BRANCH=$(git branch --show-current 2>/dev/null || echo "")

    if [ -z "$BRANCH" ]; then
      exit 0
    fi

    PR_STATE=$(gh pr view "$BRANCH" --json state -q '.state' 2>/dev/null || echo "UNKNOWN")

    if [ "$PR_STATE" = "MERGED" ]; then
      ITEMS=$(fetch_items)
      NEXT=$(echo "$ITEMS" | jq -r \
        '[.items[] | select(.status == "Todo")] | sort_by(.priority // "Z") | .[0] | "\(.title) (#\(.content.number // "?"))"' \
        2>/dev/null || echo "none")

      if [ "$NEXT" != "none" ] && [ "$NEXT" != "null" ]; then
        CONTEXT="Your PR on branch ${BRANCH} was merged! Next available task: ${NEXT}. Use /claim to pick it up."
        CONTEXT_JSON=$(echo "$CONTEXT" | jq -Rs .)
        echo "{\"additionalContext\": ${CONTEXT_JSON}}"
      fi
    fi
    ;;

  *)
    echo '{"error": "Unknown action: '"$ACTION"'"}' >&2
    exit 1
    ;;
esac
