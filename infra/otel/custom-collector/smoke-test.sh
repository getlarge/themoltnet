#!/usr/bin/env bash
#
# End-to-end smoke test for the authenticated OTLP receiver.
#
#   1. Register an agent OAuth2 client with the `task:execute` scope
#      (idempotent — deletes & recreates if it already exists)
#   2. Obtain an access token via client credentials
#   3. POST minimal OTLP traces, logs, and metrics with the token → expect 2xx
#   4. POST with bogus and missing credentials → expect 401
#
# Prereqs:
#   - The dev stack is running: `docker compose up -d`
#   - jq and curl on PATH
#
# Usage:
#   ./smoke-test.sh
#   AGENT_CLIENT_ID=... AGENT_CLIENT_SECRET=... TALOS_API_KEY=ory_ak_... ./smoke-test.sh
#
# Exit non-zero on any assertion failure.

set -euo pipefail

HYDRA_ADMIN="${HYDRA_ADMIN:-http://localhost:4445}"
HYDRA_PUBLIC="${HYDRA_PUBLIC:-http://localhost:4444}"
OTLP_BASE="${OTLP_BASE:-http://localhost:4319}"
CLIENT_ID="${AGENT_CLIENT_ID:-${CLIENT_ID:-otel-smoke-test}}"
CLIENT_SECRET="${AGENT_CLIENT_SECRET:-${CLIENT_SECRET:-$(openssl rand -hex 16)}}"

red()   { printf '\033[31m%s\033[0m\n' "$*" >&2; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
blue()  { printf '\033[34m%s\033[0m\n' "$*"; }

USE_REGISTERED_AGENT=false
if [[ -n "${AGENT_CLIENT_ID:-}" || -n "${AGENT_CLIENT_SECRET:-}" ]]; then
  if [[ -z "${AGENT_CLIENT_ID:-}" || -z "${AGENT_CLIENT_SECRET:-}" ]]; then
    red "AGENT_CLIENT_ID and AGENT_CLIENT_SECRET must be set together"
    exit 1
  fi
  USE_REGISTERED_AGENT=true
fi

# --- 1. Register client (idempotent) ----------------------------------

if [[ "$USE_REGISTERED_AGENT" == "true" ]]; then
  blue "[1/5] Using registered MoltNet agent OAuth client '$CLIENT_ID'..."
else
  blue "[1/5] Ensuring compatibility OAuth2 agent client '$CLIENT_ID' has task:execute..."

  # Delete only the disposable smoke client — never mutate a supplied agent.
  curl -sS -X DELETE "$HYDRA_ADMIN/admin/clients/$CLIENT_ID" >/dev/null 2>&1 || true

  REGISTER_RESPONSE=$(curl -sS -X POST "$HYDRA_ADMIN/admin/clients" \
    -H 'Content-Type: application/json' \
    -d @- <<EOF
{
  "client_id": "$CLIENT_ID",
  "client_secret": "$CLIENT_SECRET",
  "grant_types": ["client_credentials"],
  "response_types": ["token"],
  "scope": "task:execute",
  "metadata": {"type": "moltnet_agent", "identity_id": "00000000-0000-4000-8000-000000000183"},
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
  green "  Compatibility client registered."
fi

# --- 2. Obtain access token -------------------------------------------

blue "[2/5] Requesting access token via client_credentials..."

TOKEN_RESPONSE=$(curl -sS -X POST "$HYDRA_PUBLIC/oauth2/token" \
  -u "$CLIENT_ID:$CLIENT_SECRET" \
  -d 'grant_type=client_credentials&scope=task:execute')

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

# --- 4. Bogus bearer — expect 401 -------------------------------------

blue "[4/5] POST /v1/traces with bogus token (expect 401)..."
STATUS=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$OTLP_BASE/v1/traces" \
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
STATUS=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$OTLP_BASE/v1/traces" \
  -H 'Content-Type: application/json' \
  -d "$OTLP_PAYLOAD")
if [[ "$STATUS" != "401" ]]; then
  red "  Expected 401, got $STATUS"
  exit 1
fi
green "  status=$STATUS"

green ""
green "All assertions passed."
