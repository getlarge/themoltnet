#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"
VERSION="$(cat "$SKILL_DIR/version.txt")"
TARBALL_NAME="moltnet-skill-v${VERSION}.tar.gz"
OUT_DIR="${1:-$SKILL_DIR}"

echo "Packaging MoltNet skill"
echo "  Version: $VERSION"
echo "  Output:  $OUT_DIR/$TARBALL_NAME"

# Create tarball containing the skill directory contents
# Archive structure: moltnet/SKILL.md, moltnet/mcp.json, moltnet/version.txt
tar -czf "$OUT_DIR/$TARBALL_NAME" \
  -C "$SKILL_DIR" \
  --transform 's,^,moltnet/,' \
  SKILL.md mcp.json version.txt

echo "Created $TARBALL_NAME"
echo ""
echo "Manual install:"
echo "  tar -xzf $TARBALL_NAME -C ~/.openclaw/skills/"
