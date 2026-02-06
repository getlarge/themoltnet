#!/usr/bin/env bash
set -euo pipefail

# Agent Sync — Phase-driven task lifecycle automation for Claude Code hooks.
#
# Called by Claude Code hooks (SessionStart, Stop, Notification).
# Reads JSON from stdin (hook context), writes JSON to stdout.
#
# The lifecycle is driven by .agent-claim.json signal file phases:
#   /claim → coding → ready_for_pr → pr_created → checks_running → done
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
REPO="${PROJECT_OWNER}/themoltnet"
CLAIM_FILE="${CLAUDE_PROJECT_DIR:-.}/.agent-claim.json"

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

read_claim_field() {
  local field="$1"
  jq -r --arg f "$field" '.[$f] // empty' "$CLAIM_FILE"
}

write_claim_field() {
  local field="$1"
  local value="$2"
  local tmp
  tmp=$(mktemp)
  jq --arg f "$field" --arg v "$value" '.[$f] = $v' "$CLAIM_FILE" > "$tmp" && mv "$tmp" "$CLAIM_FILE"
}

write_claim_field_raw() {
  local field="$1"
  local value="$2"
  local tmp
  tmp=$(mktemp)
  jq --arg f "$field" --argjson v "$value" '.[$f] = $v' "$CLAIM_FILE" > "$tmp" && mv "$tmp" "$CLAIM_FILE"
}

emit_context() {
  local msg="$1"
  local json
  json=$(echo "$msg" | jq -Rs .)
  echo "{\"additionalContext\": ${json}}"
}

# --- Phase lifecycle functions ---

create_pr() {
  local branch summary issue_number item_id

  branch=$(read_claim_field "branch")
  summary=$(read_claim_field "summary")
  issue_number=$(read_claim_field "issue_number")
  item_id=$(read_claim_field "item_id")

  if [ -z "$branch" ] || [ -z "$summary" ]; then
    emit_context "Cannot create PR: missing branch or summary in signal file."
    return 1
  fi

  # Idempotent: check if PR already exists for this branch
  local existing_pr
  existing_pr=$(gh pr view "$branch" --repo "$REPO" --json number -q '.number' 2>/dev/null || echo "")
  if [ -n "$existing_pr" ]; then
    write_claim_field "phase" "pr_created"
    write_claim_field_raw "pr_number" "$existing_pr"
    emit_context "PR #${existing_pr} already exists for branch ${branch}. Phase updated to pr_created."
    return 0
  fi

  # Build PR body with mission integrity checklist (pre-checked)
  local closes_line=""
  if [ -n "$issue_number" ] && [ "$issue_number" != "null" ]; then
    closes_line="Closes #${issue_number}"
  fi

  local body
  body=$(cat <<PRBODY
## Summary

${summary}

${closes_line}

## Mission Integrity Checklist

Every change to MoltNet must pass these checks (see [MISSION_INTEGRITY.md](docs/MISSION_INTEGRITY.md)):

- [x] **Agent control**: This change does NOT move control away from the agent
- [x] **Offline verifiable**: Anything this change produces can be verified without the server (or N/A for infra-only changes)
- [x] **Platform survival**: This change works even if a managed service (Ory, Supabase, Fly.io) goes down or is replaced
- [x] **Simplicity**: This is the simplest solution that solves the problem
- [x] **Documented**: Architectural decisions are recorded (journal entry, code comments, or doc update)

## Test plan

- [ ] Tests pass (\`pnpm run test\`)
- [ ] Type check passes (\`pnpm run typecheck\`)
- [ ] Lint passes (\`pnpm run lint\`)
PRBODY
)

  local pr_url pr_number
  pr_url=$(gh pr create \
    --repo "$REPO" \
    --title "$summary" \
    --body "$body" \
    --base main \
    --head "$branch" 2>&1) || {
    emit_context "Failed to create PR: ${pr_url}"
    return 1
  }

  pr_number=$(gh pr view "$branch" --repo "$REPO" --json number -q '.number' 2>/dev/null || echo "")

  if [ -n "$pr_number" ]; then
    write_claim_field "phase" "pr_created"
    write_claim_field_raw "pr_number" "$pr_number"
    write_claim_field "status" "In Review"

    # Update project board status
    if [ -n "$item_id" ] && [ "$item_id" != "null" ]; then
      update_item_field "$item_id" "Status" "In Review"
    fi

    emit_context "PR #${pr_number} created: ${pr_url}. Board updated to In Review."
  else
    emit_context "PR created at ${pr_url} but could not read PR number."
  fi
}

poll_checks() {
  local pr_number last_poll now elapsed

  pr_number=$(read_claim_field "pr_number")
  if [ -z "$pr_number" ] || [ "$pr_number" = "null" ]; then
    return 0
  fi

  # 2-minute backoff
  last_poll=$(read_claim_field "last_check_poll")
  now=$(date +%s)
  if [ -n "$last_poll" ] && [ "$last_poll" != "null" ]; then
    local last_epoch
    # macOS: date -j, GNU/Linux: date -d
    last_epoch=$(date -j -f "%Y-%m-%dT%H:%M:%S" "${last_poll%Z}" +%s 2>/dev/null \
      || date -d "$last_poll" +%s 2>/dev/null \
      || echo "0")
    elapsed=$(( now - last_epoch ))
    if [ "$elapsed" -lt 120 ]; then
      return 0
    fi
  fi

  write_claim_field "last_check_poll" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  local checks_output
  checks_output=$(gh pr checks "$pr_number" --repo "$REPO" 2>&1 || true)

  local total passed failed pending
  total=$(echo "$checks_output" | grep -c '.' || echo "0")
  passed=$(echo "$checks_output" | grep -c 'pass' || echo "0")
  failed=$(echo "$checks_output" | grep -c 'fail' || echo "0")
  pending=$(echo "$checks_output" | grep -c 'pending\|queued\|in_progress' || echo "0")

  if [ "$failed" -gt 0 ]; then
    local failed_names
    failed_names=$(echo "$checks_output" | grep 'fail' | awk '{print $1}' | head -5 | tr '\n' ', ' | sed 's/,$//')
    write_claim_field "phase" "checks_running"
    emit_context "CI checks: ${passed}/${total} passed, ${failed} FAILED (${failed_names}). Run \`gh pr checks ${pr_number} --watch\` for details."
  elif [ "$pending" -gt 0 ]; then
    write_claim_field "phase" "checks_running"
    emit_context "CI checks: ${passed}/${total} passed, ${pending} still running..."
  else
    emit_context "CI passed! All ${total} checks green. PR #${pr_number} is ready to merge."
  fi
}

check_merged_and_close() {
  local pr_number issue_number

  pr_number=$(read_claim_field "pr_number")
  if [ -z "$pr_number" ] || [ "$pr_number" = "null" ]; then
    return 0
  fi

  local pr_state
  pr_state=$(gh pr view "$pr_number" --repo "$REPO" --json state -q '.state' 2>/dev/null || echo "UNKNOWN")

  if [ "$pr_state" = "MERGED" ]; then
    issue_number=$(read_claim_field "issue_number")
    if [ -n "$issue_number" ] && [ "$issue_number" != "null" ]; then
      emit_context "PR #${pr_number} merged! Should I close issue #${issue_number}? (Say yes to proceed, the hook will handle it.)"
    else
      emit_context "PR #${pr_number} merged! No linked issue to close."
    fi
  fi
}

close_issue_and_cleanup() {
  local item_id issue_number pr_number agent_id

  item_id=$(read_claim_field "item_id")
  issue_number=$(read_claim_field "issue_number")
  pr_number=$(read_claim_field "pr_number")
  agent_id=$(read_claim_field "agent_id")

  if [ -n "$issue_number" ] && [ "$issue_number" != "null" ]; then
    gh issue close "$issue_number" \
      --repo "$REPO" \
      --comment "Completed in #${pr_number:-?}" 2>/dev/null || true
  fi

  if [ -n "$item_id" ] && [ "$item_id" != "null" ]; then
    update_item_field "$item_id" "Status" "Done"
    update_item_text "$item_id" "Agent" ""
  fi

  rm -f "$CLAIM_FILE"
  emit_context "Issue #${issue_number:-?} closed. Board updated to Done. Signal file cleaned up."
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
    if [ ! -f "$CLAIM_FILE" ]; then
      exit 0
    fi

    PHASE=$(read_claim_field "phase")

    case "$PHASE" in
      ready_for_pr)
        create_pr
        ;;
      done)
        close_issue_and_cleanup
        ;;
      coding|pr_created|checks_running)
        # Sync status to project board (existing behavior)
        ITEM_ID=$(read_claim_field "item_id")
        NEW_STATUS=$(read_claim_field "status")
        AGENT_ID=$(read_claim_field "agent_id")

        if [ -n "$ITEM_ID" ] && [ -n "$NEW_STATUS" ]; then
          update_item_field "$ITEM_ID" "Status" "$NEW_STATUS"
          update_item_text "$ITEM_ID" "Agent" "${AGENT_ID:-unknown}"
        fi
        ;;
      *)
        # Unknown phase — still sync status if present
        ITEM_ID=$(read_claim_field "item_id")
        NEW_STATUS=$(read_claim_field "status")
        AGENT_ID=$(read_claim_field "agent_id")

        if [ -n "$ITEM_ID" ] && [ -n "$NEW_STATUS" ]; then
          update_item_field "$ITEM_ID" "Status" "$NEW_STATUS"
          update_item_text "$ITEM_ID" "Agent" "${AGENT_ID:-unknown}"
        fi
        ;;
    esac
    ;;

  on-idle)
    if [ -f "$CLAIM_FILE" ]; then
      PHASE=$(read_claim_field "phase")

      case "$PHASE" in
        pr_created|checks_running)
          # Check if merged first — if so, prompt for closure instead of polling checks
          PR_NUM=$(read_claim_field "pr_number")
          PR_STATE=$(gh pr view "$PR_NUM" --repo "$REPO" --json state -q '.state' 2>/dev/null || echo "UNKNOWN")
          if [ "$PR_STATE" = "MERGED" ]; then
            check_merged_and_close
          else
            poll_checks
          fi
          ;;
        *)
          # Fall through to existing branch-based merge detection
          ;;
      esac
    else
      # No signal file — use existing branch-based merge detection
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
    fi
    ;;

  *)
    echo '{"error": "Unknown action: '"$ACTION"'"}' >&2
    exit 1
    ;;
esac
