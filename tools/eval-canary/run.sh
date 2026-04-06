#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<EOF
Usage: $0 --config <eval.yaml> [--concurrency N] [--model MODEL] [--judge-model MODEL]

Run both Harbor and DSPy eval engines on the same config and compare results.
Requires: moltnet CLI on PATH, jq, Docker (for Harbor), claude CLI (for DSPy).
EOF
  exit 1
}

CONFIG=""
PASSTHROUGH_FLAGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --config|-c) CONFIG="$2"; shift 2 ;;
    --concurrency|--model|--judge-model)
      PASSTHROUGH_FLAGS+=("$1" "$2"); shift 2 ;;
    --help|-h) usage ;;
    *) echo "Unknown flag: $1"; usage ;;
  esac
done

[[ -z "$CONFIG" ]] && { echo "Error: --config is required"; usage; }
[[ ! -f "$CONFIG" ]] && { echo "Error: config file not found: $CONFIG"; exit 1; }

command -v moltnet >/dev/null || { echo "Error: moltnet CLI not found on PATH"; exit 1; }
command -v jq >/dev/null || { echo "Error: jq not found on PATH"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

extract_artifact_dir() {
  # Capture the "Artifacts preserved at: <path>" line from stderr
  grep -oE 'Artifacts preserved at: .*' "$1" | sed 's/Artifacts preserved at: //' | tail -1
}

echo "=== Canary: Running Harbor engine ==="
HARBOR_LOG=$(mktemp)
if moltnet eval run --engine harbor --config "$CONFIG" "${PASSTHROUGH_FLAGS[@]}" 2>"$HARBOR_LOG"; then
  echo "Harbor: completed successfully"
else
  echo "Harbor: completed with errors (continuing)"
fi
HARBOR_DIR=$(extract_artifact_dir "$HARBOR_LOG")
cat "$HARBOR_LOG" >&2
rm -f "$HARBOR_LOG"

if [[ -z "$HARBOR_DIR" ]]; then
  echo "Error: could not find Harbor artifact directory"
  exit 1
fi

echo ""
echo "=== Canary: Running DSPy engine ==="
DSPY_LOG=$(mktemp)
if moltnet eval run --engine dspy --config "$CONFIG" "${PASSTHROUGH_FLAGS[@]}" 2>"$DSPY_LOG"; then
  echo "DSPy: completed successfully"
else
  echo "DSPy: completed with errors (continuing)"
fi
DSPY_DIR=$(extract_artifact_dir "$DSPY_LOG")
cat "$DSPY_LOG" >&2
rm -f "$DSPY_LOG"

if [[ -z "$DSPY_DIR" ]]; then
  echo "Error: could not find DSPy artifact directory"
  exit 1
fi

HARBOR_RESULT="$HARBOR_DIR/job_result.json"
DSPY_RESULT="$DSPY_DIR/job_result.json"

[[ ! -f "$HARBOR_RESULT" ]] && { echo "Error: Harbor job_result.json not found at $HARBOR_RESULT"; exit 1; }
[[ ! -f "$DSPY_RESULT" ]] && { echo "Error: DSPy job_result.json not found at $DSPY_RESULT"; exit 1; }

echo ""
echo "=== Canary: Comparing results ==="
exec "$SCRIPT_DIR/compare.sh" "$HARBOR_RESULT" "$DSPY_RESULT"
