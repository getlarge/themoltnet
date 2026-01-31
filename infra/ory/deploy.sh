#!/usr/bin/env bash
# Deploy Ory project configuration.
#
# Reads project.json, substitutes environment variables,
# base64-encodes identity-schema.json into the template,
# and optionally pushes to Ory Network via the CLI.
#
# Required environment variables:
#   BASE_DOMAIN          - e.g. themolt.net
#   APP_BASE_URL         - e.g. https://themolt.net
#   API_BASE_URL         - e.g. https://api.themolt.net
#   OIDC_PAIRWISE_SALT   - random string (>= 32 chars)
#
# Optional:
#   ORY_PROJECT_ID       - Ory project ID (required for --apply)
#   DRY_RUN              - set to "false" to actually apply (default: true)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_TEMPLATE="${SCRIPT_DIR}/project.json"
IDENTITY_SCHEMA="${SCRIPT_DIR}/identity-schema.json"
OUTPUT_FILE="${SCRIPT_DIR}/project.resolved.json"

# --- Validate required vars ---
missing=()
for var in BASE_DOMAIN APP_BASE_URL API_BASE_URL OIDC_PAIRWISE_SALT; do
  if [[ -z "${!var:-}" ]]; then
    missing+=("$var")
  fi
done

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "ERROR: Missing required environment variables: ${missing[*]}" >&2
  echo "" >&2
  echo "Example:" >&2
  echo "  export BASE_DOMAIN=themolt.net" >&2
  echo "  export APP_BASE_URL=https://themolt.net" >&2
  echo "  export API_BASE_URL=https://api.themolt.net" >&2
  echo "  export OIDC_PAIRWISE_SALT=\$(openssl rand -hex 32)" >&2
  exit 1
fi

# --- Base64-encode the identity schema ---
IDENTITY_SCHEMA_BASE64=$(base64 -w0 < "$IDENTITY_SCHEMA" 2>/dev/null || base64 -i "$IDENTITY_SCHEMA")

# --- Substitute variables ---
export BASE_DOMAIN APP_BASE_URL API_BASE_URL OIDC_PAIRWISE_SALT IDENTITY_SCHEMA_BASE64

envsubst < "$PROJECT_TEMPLATE" > "$OUTPUT_FILE"

echo "Resolved config written to: $OUTPUT_FILE"
echo ""
echo "  BASE_DOMAIN:    $BASE_DOMAIN"
echo "  APP_BASE_URL:   $APP_BASE_URL"
echo "  API_BASE_URL:   $API_BASE_URL"
echo "  OIDC_SALT:      ${OIDC_PAIRWISE_SALT:0:8}..."
echo "  SCHEMA:         $(wc -c < "$IDENTITY_SCHEMA" | tr -d ' ') bytes"
echo ""

# --- Optionally apply to Ory Network ---
DRY_RUN="${DRY_RUN:-true}"

if [[ "$DRY_RUN" != "false" ]]; then
  echo "Dry run — not applying to Ory Network."
  echo "To apply: DRY_RUN=false ORY_PROJECT_ID=<id> $0"
  exit 0
fi

if [[ -z "${ORY_PROJECT_ID:-}" ]]; then
  echo "ERROR: ORY_PROJECT_ID is required when DRY_RUN=false" >&2
  exit 1
fi

if ! command -v ory &>/dev/null; then
  echo "ERROR: ory CLI not found. Install from https://www.ory.sh/docs/guides/cli/installation" >&2
  exit 1
fi

echo "Applying config to Ory project: $ORY_PROJECT_ID ..."
ory update project "$ORY_PROJECT_ID" --file "$OUTPUT_FILE"
echo "Done."
