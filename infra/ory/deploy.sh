#!/usr/bin/env bash
# Deploy Ory project configuration.
#
# Loads public config from .env.public and secrets from .env (encrypted
# via dotenvx), substitutes them into project.json, and optionally pushes
# to Ory Network via the CLI.
#
# IDENTITY_SCHEMA_BASE64 is computed here from the schema file so it
# never needs to be stored or encrypted in any .env file.
#
# Usage:
#   npx @dotenvx/dotenvx run -f .env.public -f .env -- ./infra/ory/deploy.sh              # dry run
#   npx @dotenvx/dotenvx run -f .env.public -f .env -- ./infra/ory/deploy.sh --apply       # push to Ory
#
# In CI (no .env.keys file):
#   DOTENV_PRIVATE_KEY="<key>" npx @dotenvx/dotenvx run -f .env.public -f .env -- ./infra/ory/deploy.sh --apply

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PROJECT_TEMPLATE="${SCRIPT_DIR}/project.json"
OUTPUT_FILE="${SCRIPT_DIR}/project.resolved.json"

# --- Compute IDENTITY_SCHEMA_BASE64 from the schema file ---
SCHEMA_FILE="${SCRIPT_DIR}/identity-schema.json"
if [[ ! -f "$SCHEMA_FILE" ]]; then
  echo "ERROR: Identity schema not found at $SCHEMA_FILE" >&2
  exit 1
fi
export IDENTITY_SCHEMA_BASE64
IDENTITY_SCHEMA_BASE64="$(base64 -w0 "$SCHEMA_FILE" 2>/dev/null || base64 "$SCHEMA_FILE")"

# --- Validate required vars (injected by dotenvx from .env.public + .env) ---
missing=()
for var in BASE_DOMAIN APP_BASE_URL API_BASE_URL OIDC_PAIRWISE_SALT; do
  if [[ -z "${!var:-}" ]]; then
    missing+=("$var")
  fi
done

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "ERROR: Missing environment variables: ${missing[*]}" >&2
  echo "" >&2
  echo "Run this script through dotenvx:" >&2
  echo "  npx @dotenvx/dotenvx run -f .env.public -f .env -- $0" >&2
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
  echo "To apply: npx @dotenvx/dotenvx run -f .env.public -f .env -- $0 --apply"
  exit 0
fi

if [[ -z "${ORY_PROJECT_ID:-}" ]]; then
  echo "ERROR: ORY_PROJECT_ID must be set in .env.public for --apply" >&2
  exit 1
fi

if ! command -v ory &>/dev/null; then
  echo "ERROR: ory CLI not found. Install from https://www.ory.sh/docs/guides/cli/installation" >&2
  exit 1
fi

echo "Applying config to Ory project: $ORY_PROJECT_ID ..."
ory update project "$ORY_PROJECT_ID" --file "$OUTPUT_FILE"
echo "Done."
