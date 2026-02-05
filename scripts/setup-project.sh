#!/usr/bin/env bash
set -euo pipefail

# Setup script for MoltNet GitHub Project board.
# Run once to create the project and all custom fields.
# Requires: gh CLI with `project` scope (run `gh auth refresh -s project`)
#
# Usage: ./scripts/setup-project.sh [OWNER]

OWNER="${1:-getlarge}"

echo "Creating GitHub Project for ${OWNER}..."

# Create the project
PROJECT_URL=$(gh project create --owner "$OWNER" --title "MoltNet Agent Board" --format url 2>/dev/null || true)
if [ -z "$PROJECT_URL" ]; then
  echo "Project may already exist. Listing projects:"
  gh project list --owner "$OWNER" --format json | jq '.projects[] | {number, title, url}'
  echo ""
  echo "Set MOLTNET_PROJECT_NUMBER to the project number and re-run with --fields-only to add fields."
  exit 0
fi

# Extract project number from URL (last segment)
PROJECT_NUMBER=$(echo "$PROJECT_URL" | grep -oP '\d+$')
echo "Created project #${PROJECT_NUMBER}: ${PROJECT_URL}"

# Create custom fields
echo "Creating custom fields..."

gh project field-create "$PROJECT_NUMBER" --owner "$OWNER" \
  --name "Priority" --data-type "SINGLE_SELECT" \
  --single-select-options "P0: Critical,P1: High,P2: Medium,P3: Low"

gh project field-create "$PROJECT_NUMBER" --owner "$OWNER" \
  --name "Readiness" --data-type "SINGLE_SELECT" \
  --single-select-options "Draft,Needs Spec,Ready for Agent"

gh project field-create "$PROJECT_NUMBER" --owner "$OWNER" \
  --name "Effort" --data-type "SINGLE_SELECT" \
  --single-select-options "XS,S,M,L,XL"

gh project field-create "$PROJECT_NUMBER" --owner "$OWNER" \
  --name "Workstream" --data-type "SINGLE_SELECT" \
  --single-select-options "WS1,WS2,WS3,WS4,WS5,WS6,WS7,WS8,WS9,WS10,WS11"

gh project field-create "$PROJECT_NUMBER" --owner "$OWNER" \
  --name "Agent" --data-type "TEXT"

gh project field-create "$PROJECT_NUMBER" --owner "$OWNER" \
  --name "Dependencies" --data-type "TEXT"

echo ""
echo "Done. Project #${PROJECT_NUMBER} is ready."
echo "Add to your .env.public:"
echo "  MOLTNET_PROJECT_NUMBER=${PROJECT_NUMBER}"
echo "  MOLTNET_PROJECT_OWNER=${OWNER}"
