#!/usr/bin/env bash
#
# End-to-end smoke test for the authenticated OTLP receiver.
#
#   1. Register an OAuth2 client in local Hydra with the `telemetry:write` scope
#      (idempotent — deletes & recreates if it already exists)
#   2. Obtain an access token via client credentials
#   3. POST a minimal OTLP trace to :4319 with the token → expect 202
#   4. POST the same payload with a bogus token → expect 401
#   5. POST with no auth header → expect 401
#
# Prereqs:
#   - The dev stack is running: `docker compose up -d`
#   - jq and curl on PATH
#
# Usage:
#   ./smoke-test.sh
#
# Exit non-zero on any assertion failure.

set -euo pipefail

HYDRA_ADMIN="${HYDRA_ADMIN:-http://localhost:4445}"
HYDRA_PUBLIC="${HYDRA_PUBLIC:-http://localhost:4444}"
OTLP_ENDPOINT="${OTLP_ENDPOINT:-http://localhost:4319/v1/traces}"
CLIENT_ID="${CLIENT_ID:-otel-smoke-test}"
CLIENT_SECRET="${CLIENT_SECRET:-$(openssl rand -hex 16)}"

red()   { printf '\033[31m%s\033[0m\n' "$*" >&2; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
blue()  { printf '\033[34m%s\033[0m\n' "$*"; }

# --- 1. Register client (idempotent) ----------------------------------

blue "[1/5] Ensuring OAuth2 client '$CLIENT_ID' exists with telemetry:write scope..."

# Delete first — simplest path to idempotency without juggling PUT semantics.
curl -sS -X DELETE "$HYDRA_ADMIN/admin/clients/$CLIENT_ID" >/dev/null 2>&1 || true

REGISTER_RESPONSE=$(curl -sS -X POST "$HYDRA_ADMIN/admin/clients" \
  -H 'Content-Type: application/json' \
  -d @- <<EOF
{
  "client_id": "$CLIENT_ID",
  "client_secret": "$CLIENT_SECRET",
  "grant_types": ["client_credentials"],
  "response_types": ["token"],
  "scope": "telemetry:write",
  "token_endpoint_auth_method": "client_secret_basic",
  "access_token_strategy": "opaque"
}
EOF
)

if ! echo "$REGISTER_RESPONSE" | jq -e '.client_id' >/dev/null 2>&1; then
  red "Client registration failed:"
  echo "$REGISTER_RESPONSE" >&2
  exit 1
fi
green "  Client registered."

# --- 2. Obtain access token -------------------------------------------

blue "[2/5] Requesting access token via client_credentials..."

TOKEN_RESPONSE=$(curl -sS -X POST "$HYDRA_PUBLIC/oauth2/token" \
  -u "$CLIENT_ID:$CLIENT_SECRET" \
  -d 'grant_type=client_credentials&scope=telemetry:write')

ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.access_token // empty')
if [[ -z "$ACCESS_TOKEN" ]]; then
  red "Token exchange failed:"
  echo "$TOKEN_RESPONSE" >&2
  exit 1
fi
green "  Got token (length: ${#ACCESS_TOKEN})."

# Minimal valid OTLP/HTTP traces payload — one span in one resource.
# Contents aren't inspected end-to-end; we only care that the collector
# accepts the request past the auth gate.
OTLP_PAYLOAD='{
  "resourceSpans": [{
    "resource": {
      "attributes": [
        {"key": "service.name", "value": {"stringValue": "smoke-test"}}
      ]
    },
    "scopeSpans": [{
      "scope": {"name": "smoke-test"},
      "spans": [{
        "traceId": "5b8aa5a2d2c872e8321cf37308d69df2",
        "spanId": "051581bf3cb55c13",
        "name": "smoke",
        "startTimeUnixNano": "1700000000000000000",
        "endTimeUnixNano": "1700000000100000000",
        "kind": 1
      }]
    }]
  }]
}'

# --- 3. Authenticated request — expect 2xx ----------------------------

blue "[3/5] POST /v1/traces with valid token (expect 2xx)..."
STATUS=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$OTLP_ENDPOINT" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "$OTLP_PAYLOAD")
if [[ "$STATUS" != "200" && "$STATUS" != "202" ]]; then
  red "  Expected 200/202, got $STATUS"
  exit 1
fi
green "  status=$STATUS"

# --- 4. Bogus bearer — expect 401 -------------------------------------

blue "[4/5] POST /v1/traces with bogus token (expect 401)..."
STATUS=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$OTLP_ENDPOINT" \
  -H 'Authorization: Bearer not-a-real-token' \
  -H 'Content-Type: application/json' \
  -d "$OTLP_PAYLOAD")
if [[ "$STATUS" != "401" ]]; then
  red "  Expected 401, got $STATUS"
  exit 1
fi
green "  status=$STATUS"

# --- 5. Missing auth header — expect 401 ------------------------------

blue "[5/5] POST /v1/traces with no Authorization header (expect 401)..."
STATUS=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$OTLP_ENDPOINT" \
  -H 'Content-Type: application/json' \
  -d "$OTLP_PAYLOAD")
if [[ "$STATUS" != "401" ]]; then
  red "  Expected 401, got $STATUS"
  exit 1
fi
green "  status=$STATUS"

green ""
green "All assertions passed."
