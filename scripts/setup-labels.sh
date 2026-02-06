#!/usr/bin/env bash
set -euo pipefail

# Create GitHub labels for agent coordination.
# Idempotent — uses --force so safe to run multiple times.
#
# Usage: ./scripts/setup-labels.sh [OWNER/REPO]

REPO="${1:-getlarge/themoltnet}"

echo "Creating labels on ${REPO}..."

# Readiness labels
gh label create "ready-for-agent" --repo "$REPO" --color "0E8A16" --description "Issue is well-specified and ready for agent pickup" --force
gh label create "needs-spec" --repo "$REPO" --color "E4E669" --description "Issue needs more detail before agent can work on it" --force

# Priority labels
gh label create "priority:critical" --repo "$REPO" --color "B60205" --description "P0 — Drop everything" --force
gh label create "priority:high" --repo "$REPO" --color "D93F0B" --description "P1 — Do next" --force
gh label create "priority:medium" --repo "$REPO" --color "FBCA04" --description "P2 — Normal priority" --force
gh label create "priority:low" --repo "$REPO" --color "0075CA" --description "P3 — When time allows" --force

# Effort labels
gh label create "effort:xs" --repo "$REPO" --color "C5DEF5" --description "Extra small — < 30 min" --force
gh label create "effort:s" --repo "$REPO" --color "BFD4F2" --description "Small — 30 min to 1 hour" --force
gh label create "effort:m" --repo "$REPO" --color "A2C4E0" --description "Medium — 1-2 hours" --force
gh label create "effort:l" --repo "$REPO" --color "7BA7CC" --description "Large — 2-4 hours" --force
gh label create "effort:xl" --repo "$REPO" --color "5B8DB8" --description "Extra large — 4+ hours" --force

# Workstream labels
for ws in $(seq 1 11); do
  gh label create "ws${ws}" --repo "$REPO" --color "D4C5F9" --description "Workstream ${ws}" --force
done

# Agent coordination labels
gh label create "agent-task" --repo "$REPO" --color "1D76DB" --description "Task suitable for AI agent" --force
gh label create "in-progress" --repo "$REPO" --color "FEF2C0" --description "Currently being worked on by an agent" --force

echo "Done. Labels created on ${REPO}."
