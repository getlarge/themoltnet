#!/usr/bin/env bash
set -euo pipefail

# Migrate TASKS.md Available tasks to GitHub Issues and add to project board.
# Run once during migration. Idempotent — skips issues with matching titles.
#
# Usage: ./scripts/migrate-tasks-to-issues.sh [--dry-run]

DRY_RUN="${1:-}"
REPO="getlarge/themoltnet"
PROJECT_NUMBER="${MOLTNET_PROJECT_NUMBER:?Set MOLTNET_PROJECT_NUMBER first}"
PROJECT_OWNER="${MOLTNET_PROJECT_OWNER:-getlarge}"

echo "Migrating TASKS.md to GitHub Issues..."

# Parse Available section from TASKS.md
# Extract rows between ## Available and the next ## or EOF
awk '/^## Available/,/^## [A-Z]|^$/' TASKS.md | \
  grep '^|' | \
  grep -v '^| Task' | \
  grep -v '^| ---' | \
while IFS='|' read -r _ task priority deps context notes _; do
  # Trim whitespace
  task=$(echo "$task" | xargs)
  priority=$(echo "$priority" | xargs)
  deps=$(echo "$deps" | xargs)
  context=$(echo "$context" | xargs)
  notes=$(echo "$notes" | xargs)

  if [ -z "$task" ]; then continue; fi

  echo ""
  echo "Task: $task"
  echo "  Priority: $priority"
  echo "  Dependencies: $deps"
  echo "  Context: $context"

  # Check if issue already exists with matching title
  EXISTING=$(gh issue list --repo "$REPO" --search "\"$task\" in:title" --json number --jq '.[0].number' 2>/dev/null || echo "")
  if [ -n "$EXISTING" ]; then
    echo "  -> Already exists as #${EXISTING}, skipping"
    continue
  fi

  if [ "$DRY_RUN" = "--dry-run" ]; then
    echo "  -> [DRY RUN] Would create issue"
    continue
  fi

  BODY="## Description

${notes}

## Acceptance Criteria

- [ ] Implementation complete
- [ ] Tests pass
- [ ] Validation passes (\`pnpm run validate\`)

## Context Files

${context}

## Dependencies

${deps}

---
_Migrated from TASKS.md_"

  ISSUE_URL=$(gh issue create \
    --repo "$REPO" \
    --title "$task" \
    --body "$BODY" \
    --label "agent-task" 2>/dev/null || echo "FAILED")

  if [ "$ISSUE_URL" = "FAILED" ]; then
    echo "  -> Failed to create issue"
    continue
  fi

  echo "  -> Created: $ISSUE_URL"

  # Add to project board
  gh project item-add "$PROJECT_NUMBER" \
    --owner "$PROJECT_OWNER" \
    --url "$ISSUE_URL" 2>/dev/null || echo "  -> Failed to add to project"
done

echo ""
echo "Migration complete."
echo "Next steps:"
echo "  1. Review created issues on GitHub"
echo "  2. Set Priority, Effort, Workstream fields on the project board"
echo "  3. Run triage (or wait for the workflow) to set Readiness"
