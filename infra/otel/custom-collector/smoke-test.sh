#!/usr/bin/env bash
#
# End-to-end smoke test for the authenticated OTLP receiver.
#
#   1. Use a registered MoltNet agent OAuth2 client
#   2. Obtain an access token via client credentials
#   3. POST minimal OTLP traces, logs, and metrics with the token → expect 2xx
#   4. POST with bogus and missing credentials → expect 401
#
# Prereqs:
#   - The dev stack is running: `docker compose up -d`
#   - jq and curl on PATH
#
# Usage:
#   AGENT_CLIENT_ID=... AGENT_CLIENT_SECRET=... ./smoke-test.sh
#   AGENT_CLIENT_ID=... AGENT_CLIENT_SECRET=... TALOS_API_KEY=ory_ak_... ./smoke-test.sh
#
# Exit non-zero on any assertion failure.

set -euo pipefail

HYDRA_PUBLIC="${HYDRA_PUBLIC:-http://localhost:4444}"
OTLP_BASE="${OTLP_BASE:-http://localhost:4319}"
CLIENT_ID="${AGENT_CLIENT_ID:-}"
CLIENT_SECRET="${AGENT_CLIENT_SECRET:-}"

red()   { printf '\033[31m%s\033[0m\n' "$*" >&2; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
blue()  { printf '\033[34m%s\033[0m\n' "$*"; }

if [[ -z "$CLIENT_ID" || -z "$CLIENT_SECRET" ]]; then
  red "AGENT_CLIENT_ID and AGENT_CLIENT_SECRET for a registered MoltNet agent are required"
  exit 1
fi

# --- 1. Confirm registered agent input --------------------------------

blue "[1/5] Using registered MoltNet agent OAuth client '$CLIENT_ID'..."

# --- 2. Obtain access token -------------------------------------------

blue "[2/5] Requesting access token via client_credentials..."

TOKEN_RESPONSE=$(curl -sS -X POST "$HYDRA_PUBLIC/oauth2/token" \
  --config - \
  -d 'grant_type=client_credentials&scope=task:execute' <<EOF
user = "$CLIENT_ID:$CLIENT_SECRET"
EOF
)

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

# Minimal logs and metrics payloads exercise every public pipeline.
OTLP_LOGS_PAYLOAD='{"resourceLogs":[{"scopeLogs":[{"logRecords":[{"timeUnixNano":"1700000000000000000","body":{"stringValue":"smoke"}}]}]}]}'
OTLP_METRICS_PAYLOAD='{"resourceMetrics":[{"scopeMetrics":[{"metrics":[{"name":"smoke.gauge","gauge":{"dataPoints":[{"timeUnixNano":"1700000000000000000","asDouble":1}]}}]}]}]}'

post_valid() {
  local signal="$1"
  local payload="$2"
  local credential="${3:-$ACCESS_TOKEN}"
  local status
  status=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$OTLP_BASE/v1/$signal" \
    -H "Authorization: Bearer $credential" \
    -H 'Content-Type: application/json' \
    -d "$payload")
  if [[ "$status" != "200" && "$status" != "202" ]]; then
    red "  $signal: expected 200/202, got $status"
    exit 1
  fi
  green "  $signal status=$status"
}

# --- 3. Authenticated requests — expect 2xx ---------------------------

blue "[3/5] POST traces, logs, and metrics with a valid agent token..."
post_valid traces "$OTLP_PAYLOAD"
post_valid logs "$OTLP_LOGS_PAYLOAD"
post_valid metrics "$OTLP_METRICS_PAYLOAD"

if [[ -n "${TALOS_API_KEY:-}" ]]; then
  blue "  Repeating all signals with the registered agent's Talos key..."
  post_valid traces "$OTLP_PAYLOAD" "$TALOS_API_KEY"
  post_valid logs "$OTLP_LOGS_PAYLOAD" "$TALOS_API_KEY"
  post_valid metrics "$OTLP_METRICS_PAYLOAD" "$TALOS_API_KEY"
fi

post_rejected() {
  local signal="$1"
  local payload="$2"
  local authorization="${3:-}"
  local args=(-sS -o /dev/null -w '%{http_code}' -X POST "$OTLP_BASE/v1/$signal" -H 'Content-Type: application/json' -d "$payload")
  if [[ -n "$authorization" ]]; then
    args+=(-H "$authorization")
  fi
  local status
  status=$(curl "${args[@]}")
  if [[ "$status" != "401" ]]; then
    red "  $signal: expected 401, got $status"
    exit 1
  fi
  green "  $signal status=$status"
}

# --- 4. Bogus bearer — expect 401 for every signal --------------------

blue "[4/5] POST all signals with a bogus token (expect 401)..."
post_rejected traces "$OTLP_PAYLOAD" 'Authorization: Bearer not-a-real-token'
post_rejected logs "$OTLP_LOGS_PAYLOAD" 'Authorization: Bearer not-a-real-token'
post_rejected metrics "$OTLP_METRICS_PAYLOAD" 'Authorization: Bearer not-a-real-token'

# --- 5. Missing auth header — expect 401 for every signal -------------

blue "[5/5] POST all signals with no Authorization header (expect 401)..."
post_rejected traces "$OTLP_PAYLOAD"
post_rejected logs "$OTLP_LOGS_PAYLOAD"
post_rejected metrics "$OTLP_METRICS_PAYLOAD"

green ""
green "All assertions passed."
