#!/usr/bin/env bash
# Run either direction of a two-task generation/classification chain.
set -euo pipefail

mode=${1:-}
if [[ "$mode" != generate-then-classify && "$mode" != classify-then-generate ]]; then
  echo 'Usage: chain-model-capabilities.sh generate-then-classify|classify-then-generate' >&2
  exit 2
fi
: "${TEAM_ID:?set TEAM_ID}"
: "${DIARY_ID:?set DIARY_ID}"
: "${GENERATION_PROFILE_ID:?set GENERATION_PROFILE_ID}"
: "${CLASSIFICATION_PROFILE_ID:?set CLASSIFICATION_PROFILE_ID}"
: "${REQUEST_TEXT:?set REQUEST_TEXT}"

correlation_id=${CORRELATION_ID:-$(uuidgen | tr '[:upper:]' '[:lower:]')}

create_task() {
  local task_type=$1 profile_id=$2 title=$3
  moltnet task create \
    --task-type "$task_type" \
    --team-id "$TEAM_ID" \
    --diary-id "$DIARY_ID" \
    --correlation-id "$correlation_id" \
    --allowed-profile "{\"profileId\":\"$profile_id\"}" \
    --title "$title" \
    --input-file - \
    --output id
}

accepted_output() {
  local task_id=$1 status
  for ((poll=0; poll<120; poll++)); do
    status=$(moltnet task get "$task_id" --team-id "$TEAM_ID" | jq -r '.status')
    case "$status" in
      completed)
        moltnet task attempts "$task_id" --team-id "$TEAM_ID" --accepted-only --field output
        return
        ;;
      failed|cancelled|expired)
        echo "Task $task_id ended with status $status" >&2
        return 1
        ;;
    esac
    sleep 5
  done
  echo "Timed out waiting for task $task_id" >&2
  return 1
}

create_generation() {
  local brief=$1
  jq -n --arg brief "$brief" '{
    brief: $brief,
    expectedOutput: "Submit result.draft as one short sentence.",
    outputContract: {
      version: 1,
      schema: {
        type: "object",
        properties: {draft: {type: "string", minLength: 1}},
        required: ["draft"],
        additionalProperties: false
      }
    }
  }' | create_task freeform "$GENERATION_PROFILE_ID" 'Generate a draft'
}

create_classification() {
  local text=$1
  jq -n --arg text "$text" '{
    version: 1,
    state: {text: $text},
    questions: {
      urgency: {
        type: "choice",
        instructions: "Classify the urgency of state.text.",
        criteria: {
          urgent: "Needs attention today",
          routine: "Can be handled in the normal queue"
        }
      }
    }
  }' | create_task classify "$CLASSIFICATION_PROFILE_ID" 'Classify urgency'
}

urgency_choice() {
  jq -er '.answers.urgency | select(.type == "choice") | .choice | select(. == "urgent" or . == "routine")' <<< "$1"
}

if [[ "$mode" == generate-then-classify ]]; then
  generation_id=$(create_generation "Draft a one-sentence reply to: $REQUEST_TEXT")
  generation_output=$(accepted_output "$generation_id")
  draft=$(jq -er '.result.draft | select(type == "string" and length > 0)' <<< "$generation_output")
  classification_id=$(create_classification "$draft")
  classification_output=$(accepted_output "$classification_id")
  choice=$(urgency_choice "$classification_output")
  jq -n --arg correlationId "$correlation_id" \
    --arg generationTaskId "$generation_id" \
    --arg classificationTaskId "$classification_id" \
    --arg draft "$draft" \
    --arg choice "$choice" \
    --argjson classification "$classification_output" \
    '{correlationId: $correlationId, generationTaskId: $generationTaskId, classificationTaskId: $classificationTaskId, draft: $draft, choice: $choice, classification: $classification}'
else
  classification_id=$(create_classification "$REQUEST_TEXT")
  classification_output=$(accepted_output "$classification_id")
  choice=$(urgency_choice "$classification_output")
  generation_id=$(create_generation "Write a one-sentence $choice reply to: $REQUEST_TEXT")
  generation_output=$(accepted_output "$generation_id")
  draft=$(jq -er '.result.draft | select(type == "string" and length > 0)' <<< "$generation_output")
  jq -n --arg correlationId "$correlation_id" \
    --arg classificationTaskId "$classification_id" \
    --arg generationTaskId "$generation_id" \
    --arg choice "$choice" \
    --arg draft "$draft" \
    '{correlationId: $correlationId, classificationTaskId: $classificationTaskId, generationTaskId: $generationTaskId, choice: $choice, draft: $draft}'
fi
