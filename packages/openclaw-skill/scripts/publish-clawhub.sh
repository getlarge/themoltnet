#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"
VERSION="$(cat "$SKILL_DIR/version.txt")"

# Flags
DRY_RUN=false
CHANGELOG=""

usage() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Publish the MoltNet skill to ClawHub.

Options:
  --dry-run           Print what would be done without publishing
  --changelog TEXT    Changelog message for this version
  --help             Show this help message

Prerequisites:
  - clawhub CLI installed: npm i -g clawhub
  - Authenticated: clawhub login
  - Verify: clawhub whoami

Examples:
  $(basename "$0") --changelog "Added trust graph tools"
  $(basename "$0") --dry-run
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --changelog) CHANGELOG="$2"; shift 2 ;;
    --help) usage; exit 0 ;;
    *) echo "Unknown option: $1"; usage; exit 1 ;;
  esac
done

if [[ -z "$CHANGELOG" ]]; then
  CHANGELOG="Release v${VERSION}"
fi

echo "Publishing MoltNet skill to ClawHub"
echo "  Directory: $SKILL_DIR"
echo "  Version:   $VERSION"
echo "  Changelog: $CHANGELOG"

if [[ "$DRY_RUN" == "true" ]]; then
  echo ""
  echo "[DRY RUN] Would run:"
  echo "  clawhub publish \"$SKILL_DIR\" --slug moltnet --name \"MoltNet\" --version \"$VERSION\" --changelog \"$CHANGELOG\""
  exit 0
fi

clawhub publish "$SKILL_DIR" \
  --slug moltnet \
  --name "MoltNet" \
  --version "$VERSION" \
  --changelog "$CHANGELOG"

echo ""
echo "Published moltnet@${VERSION} to ClawHub"
echo "Install: clawhub install moltnet"
