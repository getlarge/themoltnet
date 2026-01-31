#!/usr/bin/env bash
# Deploy Ory project configuration.
#
# Uses dotenvx to decrypt .env variables, substitutes them into
# project.json, and optionally pushes to Ory Network via the CLI.
#
# Variables (encrypted in .env via dotenvx):
#   BASE_DOMAIN, APP_BASE_URL, API_BASE_URL,
#   OIDC_PAIRWISE_SALT, ORY_PROJECT_ID, ORY_PROJECT_URL,
#   IDENTITY_SCHEMA_BASE64 (derived at runtime via command substitution)
#
# Usage:
#   npx dotenvx run -- ./infra/ory/deploy.sh              # dry run
#   npx dotenvx run -- ./infra/ory/deploy.sh --apply       # push to Ory
#
# In CI (no .env.keys file):
#   DOTENV_PRIVATE_KEY="<key>" npx dotenvx run -- ./infra/ory/deploy.sh --apply

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_TEMPLATE="${SCRIPT_DIR}/project.json"
OUTPUT_FILE="${SCRIPT_DIR}/project.resolved.json"

# --- Validate required vars (injected by dotenvx) ---
missing=()
for var in BASE_DOMAIN APP_BASE_URL API_BASE_URL OIDC_PAIRWISE_SALT IDENTITY_SCHEMA_BASE64; do
  if [[ -z "${!var:-}" ]]; then
    missing+=("$var")
  fi
done

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "ERROR: Missing environment variables: ${missing[*]}" >&2
  echo "" >&2
  echo "Run this script through dotenvx:" >&2
  echo "  npx dotenvx run -- $0" >&2
  exit 1
fi

# --- Substitute ${VAR} placeholders in project.json ---
# Uses node for reliable literal string replacement (no regex escaping issues)
node -e '
  const fs = require("fs");
  let content = fs.readFileSync(process.argv[1], "utf8");
  const vars = ["BASE_DOMAIN","APP_BASE_URL","API_BASE_URL","OIDC_PAIRWISE_SALT","IDENTITY_SCHEMA_BASE64"];
  for (const v of vars) {
    content = content.split("${" + v + "}").join(process.env[v]);
  }
  fs.writeFileSync(process.argv[2], content);
' "$PROJECT_TEMPLATE" "$OUTPUT_FILE"

echo "Resolved config written to: $OUTPUT_FILE"
echo ""
echo "  BASE_DOMAIN:    $BASE_DOMAIN"
echo "  APP_BASE_URL:   $APP_BASE_URL"
echo "  API_BASE_URL:   $API_BASE_URL"
echo "  OIDC_SALT:      ${OIDC_PAIRWISE_SALT:0:8}..."
echo "  SCHEMA:         $(echo -n "$IDENTITY_SCHEMA_BASE64" | wc -c | tr -d ' ') bytes (base64)"
echo ""

# --- Optionally apply to Ory Network ---
if [[ "${1:-}" != "--apply" ]]; then
  echo "Dry run — not applying to Ory Network."
  echo "To apply: npx dotenvx run -- $0 --apply"
  exit 0
fi

if [[ -z "${ORY_PROJECT_ID:-}" ]]; then
  echo "ERROR: ORY_PROJECT_ID must be set in .env for --apply" >&2
  exit 1
fi

if ! command -v ory &>/dev/null; then
  echo "ERROR: ory CLI not found. Install from https://www.ory.sh/docs/guides/cli/installation" >&2
  exit 1
fi

echo "Applying config to Ory project: $ORY_PROJECT_ID ..."
ory update project "$ORY_PROJECT_ID" --file "$OUTPUT_FILE"
echo "Done."
