#!/usr/bin/env bash
set -euo pipefail

# Configurable thresholds
MAX_SCORE_DRIFT="${CANARY_MAX_SCORE_DRIFT:-0.10}"
MIN_COMPLETION_RATE="${CANARY_MIN_COMPLETION_RATE:-0.90}"
MAX_INFRA_FAILURE_RATE="${CANARY_MAX_INFRA_FAILURE_RATE:-0.05}"

usage() {
  cat <<EOF
Usage: $0 <harbor-job-result.json> <dspy-job-result.json>

Compare two job_result.json files and report canary metrics.

Environment variables:
  CANARY_MAX_SCORE_DRIFT         Max absolute per-scenario reward difference (default: 0.10)
  CANARY_MIN_COMPLETION_RATE     DSPy must achieve at least this (default: 0.90)
  CANARY_MAX_INFRA_FAILURE_RATE  DSPy infra failures must be below this (default: 0.05)
EOF
  exit 1
}

[[ $# -ne 2 ]] && usage

HARBOR="$1"
DSPY="$2"

[[ ! -f "$HARBOR" ]] && { echo "Error: file not found: $HARBOR"; exit 1; }
[[ ! -f "$DSPY" ]] && { echo "Error: file not found: $DSPY"; exit 1; }

command -v jq >/dev/null || { echo "Error: jq not found on PATH"; exit 1; }
command -v bc >/dev/null || { echo "Error: bc not found on PATH"; exit 1; }

# Extract summary metrics. `// 0` keeps bc happy when fields are missing/null.
h_completion=$(jq -r '.summary.completion_rate // 0' "$HARBOR")
h_infra=$(jq -r '.summary.infra_failure_rate // 0' "$HARBOR")
h_judge=$(jq -r '.summary.judge_failure_rate // 0' "$HARBOR")
h_runtime=$(jq -r '.summary.total_runtime_ms // 0' "$HARBOR")
h_cost=$(jq -r '.summary.total_cost_usd // 0' "$HARBOR")

d_completion=$(jq -r '.summary.completion_rate // 0' "$DSPY")
d_infra=$(jq -r '.summary.infra_failure_rate // 0' "$DSPY")
d_judge=$(jq -r '.summary.judge_failure_rate // 0' "$DSPY")
d_runtime=$(jq -r '.summary.total_runtime_ms // 0' "$DSPY")
d_cost=$(jq -r '.summary.total_cost_usd // 0' "$DSPY")

fmt_pct() { printf "%.1f%%" "$(echo "$1 * 100" | bc -l)"; }
fmt_time() {
  local ms="${1%.*}"
  ms="${ms:-0}"
  local s=$((ms / 1000))
  printf "%dm%02ds" $((s / 60)) $((s % 60))
}
fmt_cost() { printf "\$%.2f" "$1"; }

echo ""
echo "Canary Comparison Report"
echo "========================"
echo ""
printf "  %-12s  %-12s  %-12s  %-12s  %-12s  %s\n" "Engine" "Completion" "Infra-Fail" "Judge-Fail" "Runtime" "Cost"
printf "  %-12s  %-12s  %-12s  %-12s  %-12s  %s\n" "────────────" "────────────" "────────────" "────────────" "────────────" "────────"
printf "  %-12s  %-12s  %-12s  %-12s  %-12s  %s\n" "harbor" "$(fmt_pct "$h_completion")" "$(fmt_pct "$h_infra")" "$(fmt_pct "$h_judge")" "$(fmt_time "$h_runtime")" "$(fmt_cost "$h_cost")"
printf "  %-12s  %-12s  %-12s  %-12s  %-12s  %s\n" "dspy" "$(fmt_pct "$d_completion")" "$(fmt_pct "$d_infra")" "$(fmt_pct "$d_judge")" "$(fmt_time "$d_runtime")" "$(fmt_cost "$d_cost")"

# Per-scenario score drift
echo ""
echo "Score Drift (per scenario, without-context)"
echo "────────────────────────────────────────────"

# Use jq to join both results by scenario name and compute drift in one pass.
# Output: scenario|harbor_reward|dspy_reward|drift|abs_drift
joined=$(jq -r -n --slurpfile h "$HARBOR" --slurpfile d "$DSPY" '
  ($h[0].results | map(select(.without_context != null)) | map({(.scenario): .without_context.normalized_reward}) | add // {}) as $hmap |
  ($d[0].results | map(select(.without_context != null)) | map({(.scenario): .without_context.normalized_reward}) | add // {}) as $dmap |
  ($dmap | keys[]) as $k |
  select($hmap[$k] != null) |
  ($dmap[$k] - $hmap[$k]) as $drift |
  (if $drift < 0 then -$drift else $drift end) as $abs |
  "\($k)|\($hmap[$k])|\($dmap[$k])|\($drift)|\($abs)"
')

drift_count=0
drift_sum=0

while IFS='|' read -r name h_reward d_reward drift abs_drift; do
  [[ -z "$name" ]] && continue
  printf "  %-30s  harbor: %5.1f%%   dspy: %5.1f%%   drift: %+.1f%%\n" \
    "$name" "$(echo "$h_reward * 100" | bc -l)" "$(echo "$d_reward * 100" | bc -l)" "$(echo "$drift * 100" | bc -l)"

  drift_sum=$(echo "$drift_sum + $abs_drift" | bc -l)
  drift_count=$((drift_count + 1))
done <<< "$joined"

avg_drift=0
if [[ $drift_count -gt 0 ]]; then
  avg_drift=$(echo "$drift_sum / $drift_count" | bc -l)
fi

echo ""
printf "  Average absolute drift: %.1f%%\n" "$(echo "$avg_drift * 100" | bc -l)"

# Verdict
PASS=true
check() {
  local label="$1" ok="$2"
  if [[ "$ok" == "1" ]]; then
    echo "  ✓ $label"
  else
    echo "  ✗ $label"
    PASS=false
  fi
}

d_completion_ok=$(echo "$d_completion >= $MIN_COMPLETION_RATE" | bc -l)
d_completion_ge_harbor=$(echo "$d_completion >= $h_completion" | bc -l)
d_infra_ok=$(echo "$d_infra <= $MAX_INFRA_FAILURE_RATE" | bc -l)
drift_ok=$(echo "$avg_drift <= $MAX_SCORE_DRIFT" | bc -l)

echo ""
check "DSPy completion rate ($(fmt_pct "$d_completion")) >= threshold ($(fmt_pct "$MIN_COMPLETION_RATE"))" "$d_completion_ok"
check "DSPy completion rate ($(fmt_pct "$d_completion")) >= Harbor ($(fmt_pct "$h_completion"))" "$d_completion_ge_harbor"
check "DSPy infra-failure rate ($(fmt_pct "$d_infra")) <= threshold ($(fmt_pct "$MAX_INFRA_FAILURE_RATE"))" "$d_infra_ok"
check "Average score drift ($(printf "%.1f%%" "$(echo "$avg_drift * 100" | bc -l)")) <= threshold ($(printf "%.1f%%" "$(echo "$MAX_SCORE_DRIFT * 100" | bc -l)"))" "$drift_ok"

echo ""
if $PASS; then
  echo "Verdict: PASS ✓"
  exit 0
else
  echo "Verdict: FAIL ✗"
  exit 1
fi
