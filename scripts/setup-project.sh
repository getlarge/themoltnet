#!/usr/bin/env bash
set -euo pipefail

# Setup script for MoltNet GitHub Project board.
# Idempotent — finds existing project or creates a new one, then ensures
# all custom fields exist (skips fields already present).
#
# Requires: gh CLI with `project` scope (run `gh auth refresh -h github.com -s project`)
#
# Usage: ./scripts/setup-project.sh [OWNER] [REPO]

OWNER="${1:-getlarge}"
REPO="${2:-getlarge/themoltnet}"
PROJECT_TITLE="MoltNet Agent Board"

# Colors
if [ -t 1 ]; then
  GREEN='\033[0;32m'; YELLOW='\033[0;33m'; BLUE='\033[0;34m'; NC='\033[0m'
else
  GREEN=''; YELLOW=''; BLUE=''; NC=''
fi

log() { echo -e "${BLUE}[setup]${NC} $*"; }
ok() { echo -e "${GREEN}[setup]${NC} $*"; }
warn() { echo -e "${YELLOW}[setup]${NC} $*"; }

# --- Step 1: Find or create the project ---

log "Looking for project '${PROJECT_TITLE}' owned by ${OWNER}..."

PROJECT_NUMBER=$(
  gh project list --owner "$OWNER" --format json 2>/dev/null \
    | jq -r --arg title "$PROJECT_TITLE" '.projects[] | select(.title == $title and .closed == false) | .number' \
    | head -1
)

if [ -n "$PROJECT_NUMBER" ] && [ "$PROJECT_NUMBER" != "null" ]; then
  ok "Found existing project #${PROJECT_NUMBER}"
else
  log "No existing project found. Creating..."
  PROJECT_JSON=$(gh project create --owner "$OWNER" --title "$PROJECT_TITLE" --format json 2>&1)
  PROJECT_NUMBER=$(echo "$PROJECT_JSON" | jq -r '.number')

  if [ -z "$PROJECT_NUMBER" ] || [ "$PROJECT_NUMBER" = "null" ]; then
    echo "Failed to create project. gh output:"
    echo "$PROJECT_JSON"
    exit 1
  fi

  ok "Created project #${PROJECT_NUMBER}"
fi

# --- Step 2: Link project to repository ---

log "Linking project #${PROJECT_NUMBER} to ${REPO}..."
if gh project link "$PROJECT_NUMBER" --owner "$OWNER" --repo "$REPO" 2>/dev/null; then
  ok "Linked to ${REPO}"
else
  warn "Already linked to ${REPO} (or link failed — check manually)"
fi

# --- Step 3: Ensure custom fields exist ---

log "Checking custom fields on project #${PROJECT_NUMBER}..."

EXISTING_FIELDS=$(gh project field-list "$PROJECT_NUMBER" --owner "$OWNER" --format json 2>/dev/null)

field_exists() {
  echo "$EXISTING_FIELDS" | jq -e --arg name "$1" '.fields[] | select(.name == $name)' >/dev/null 2>&1
}

create_select_field() {
  local name="$1"
  local options="$2"
  if field_exists "$name"; then
    ok "  Field '${name}' already exists, skipping"
  else
    log "  Creating field '${name}'..."
    gh project field-create "$PROJECT_NUMBER" --owner "$OWNER" \
      --name "$name" --data-type "SINGLE_SELECT" \
      --single-select-options "$options"
    ok "  Created field '${name}'"
  fi
}

create_text_field() {
  local name="$1"
  if field_exists "$name"; then
    ok "  Field '${name}' already exists, skipping"
  else
    log "  Creating field '${name}'..."
    gh project field-create "$PROJECT_NUMBER" --owner "$OWNER" \
      --name "$name" --data-type "TEXT"
    ok "  Created field '${name}'"
  fi
}

create_select_field "Priority" "P0: Critical,P1: High,P2: Medium,P3: Low"
create_select_field "Readiness" "Draft,Needs Spec,Ready for Agent"
create_select_field "Effort" "XS,S,M,L,XL"
create_select_field "Workstream" "WS1,WS2,WS3,WS4,WS5,WS6,WS7,WS8,WS9,WS10,WS11"
create_text_field "Agent"
create_text_field "Dependencies"

# --- Step 4: Verify built-in workflows ---

log "Checking project workflows..."

PROJECT_ID=$(gh project view "$PROJECT_NUMBER" --owner "$OWNER" --format json | jq -r '.id')

WORKFLOWS=$(gh api graphql -f query="
{
  node(id: \"$PROJECT_ID\") {
    ... on ProjectV2 {
      workflows(first: 20) {
        nodes { name enabled }
      }
    }
  }
}" 2>/dev/null | jq -r '.data.node.workflows.nodes' 2>/dev/null || echo "[]")

EXPECTED_WORKFLOWS=(
  "Item closed"
  "Pull request merged"
  "Item added to project"
  "Pull request linked to issue"
  "Auto-close issue"
  "Item reopened"
  "Code changes requested"
  "Code review approved"
  "Auto-add to project"
)

DISABLED_WORKFLOWS=()
for wf_name in "${EXPECTED_WORKFLOWS[@]}"; do
  ENABLED=$(echo "$WORKFLOWS" | jq -r --arg name "$wf_name" '.[] | select(.name == $name) | .enabled' 2>/dev/null)
  if [ "$ENABLED" = "true" ]; then
    ok "  Workflow '${wf_name}': enabled"
  elif [ -z "$ENABLED" ]; then
    warn "  Workflow '${wf_name}': not found (may need to be created in UI)"
    DISABLED_WORKFLOWS+=("$wf_name")
  else
    warn "  Workflow '${wf_name}': DISABLED"
    DISABLED_WORKFLOWS+=("$wf_name")
  fi
done

# --- Step 5: Report ---

echo ""
ok "Project #${PROJECT_NUMBER} is ready: https://github.com/users/${OWNER}/projects/${PROJECT_NUMBER}"
echo ""
echo "Add to your env.public:"
echo "  MOLTNET_PROJECT_NUMBER=${PROJECT_NUMBER}"
echo "  MOLTNET_PROJECT_OWNER=${OWNER}"

if [ ${#DISABLED_WORKFLOWS[@]} -gt 0 ]; then
  echo ""
  warn "Some workflows need manual enabling in the UI:"
  warn "  https://github.com/users/${OWNER}/projects/${PROJECT_NUMBER}/workflows"
  echo ""
  echo "  Enable these workflows and configure their actions:"
  echo ""
  echo "  Item closed             → Set Status to 'Done'"
  echo "  Pull request merged     → Set Status to 'Done'"
  echo "  Item added to project   → Set Status to 'Todo'"
  echo "  Item reopened           → Set Status to 'In Progress'"
  echo "  Pull request linked     → Set Status to 'In Review'"
  echo "  Code review approved    → Set Status to 'Done'"
  echo "  Code changes requested  → Set Status to 'In Progress'"
  echo "  Auto-close issue        → When Status is 'Done', close issue"
  echo "  Auto-add to project     → Filter: label:agent-task"
fi
