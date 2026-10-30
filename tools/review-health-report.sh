#!/usr/bin/env bash
# Review-health report: per-model and per-lane task analytics for the adaptive
# review workflow, rendered as markdown tables.
#
# Wraps `moltnet task analytics activity` (the released CLI), so the report
# reads exactly the telemetry the runtime already exposes — no ad-hoc
# inference. The "Tasks" vs "Attempts" columns mirror `formatWorkflowSpend`,
# so a row whose attempt count exceeds its task count surfaces retries
# (adaptive review today runs maxAttempts: 1, so a gap is itself a finding).
#
# Usage:
#   tools/review-health-report.sh --team-id <uuid> [--since <RFC3339>] \
#       [--tags <csv>]
#
# Defaults: --tags review:adaptive, --since 7 days ago.
# GitHub: Actions > Review health report > Run workflow (default branch).
# The workflow publishes a run summary and a downloadable Markdown artifact.
set -euo pipefail

TEAM_ID=""
SINCE=""
TAGS="review:adaptive"

usage() {
  sed -n '2,16p' "$0"
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --team-id) TEAM_ID="${2:?team-id value required}"; shift 2 ;;
    --since) SINCE="${2:?since value required}"; shift 2 ;;
    --tags) TAGS="${2:?tags value required}"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "unknown argument: $1" >&2; usage ;;
  esac
done

[[ -n "$TEAM_ID" ]] || { echo "--team-id is required" >&2; usage; }
command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }
command -v moltnet >/dev/null || { echo "released moltnet CLI is required" >&2; exit 1; }

# GNU date vs BSD (macOS) date: both accept the 7-days-ago idiom differently.
if [[ -z "$SINCE" ]]; then
  if date -u -v-7d +%Y-%m-%dT%H:%M:%SZ >/dev/null 2>&1; then
    SINCE="$(date -u -v-7d +%Y-%m-%dT%H:%M:%SZ)"
  else
    SINCE="$(date -u -d '7 days ago' +%Y-%m-%dT%H:%M:%SZ)"
  fi
fi

activity() {
  moltnet task analytics activity \
    --team-id "$TEAM_ID" \
    --tags "$TAGS" \
    --completed-after "$SINCE" \
    --group-by "$1"
}

# jq helpers shared by both tables.
JQ_DUR='
def dur:
  (. / 1000 | round) as $s
  | (($s / 60) | floor) as $m
  | (($s % 60)) as $r
  | (if $m > 0 then "\($m)m \($r)s" else "\($r)s" end);
def usd:
  (. * 100 | round) as $c
  | "$" + (($c / 100 | floor | tostring) + "." + ($c % 100 | tostring | if length < 2 then "0" + . else . end));
'

HEADER='| Model | Tasks | Attempts | Term. failures | Timeouts | Failed tool calls | Median time→accept | Cost |'
SEPARATOR='| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'

# Emit markdown table rows for the given activity JSON, optionally filtering
# group labels (e.g. only "lane:*" tags).
render() {
  local json="$1" label_filter="${2:-true}"
  echo "$HEADER"
  echo "$SEPARATOR"
  echo "$json" | jq -r "$JQ_DUR .groups[] | select($label_filter) | [
    .label,
    (.metrics.success.taskCount // 0),
    (.metrics.productivity.attemptCount // 0),
    (.metrics.success.terminalFailureTaskCount // 0),
    (.metrics.hurdles.timeoutAttemptCount // 0),
    (.metrics.hurdles.failedToolCallCount // 0),
    (.metrics.productivity.medianTimeToAcceptedMs // 0),
    (.metrics.roi.estimatedCostUsd // 0)
  ] | \"| \" + .[0] + \" | \" +
    (.[1] | tostring) + \" | \" + (.[2] | tostring) + \" | \" +
    (.[3] | tostring) + \" | \" + (.[4] | tostring) + \" | \" +
    (.[5] | tostring) + \" | \" + (.[6] | dur) + \" | \" + (.[7] | usd) + \" |\""
}

echo "## Review health — $(date -u +%Y-%m-%d) (since \`$SINCE\`, tags \`$TAGS\`)"
echo
echo '### Per model'
model_activity="$(activity profile)"
render "$model_activity"
echo
echo '### Per lane'
lane_activity="$(activity tag)"
render "$lane_activity" '.label | startswith("lane:")'
echo
