# Eval Canary Comparison

Run both Harbor and DSPy eval engines on the same scenario set and compare results.

## Prerequisites

- `moltnet` CLI on PATH (`go install` or `go run .` from `apps/moltnet-cli`)
- `jq` and `bc` installed
- Docker running (for Harbor engine)
- `claude` CLI on PATH (for DSPy engine)

## Usage

```bash
# Basic run
./tools/eval-canary/run.sh --config evals/eval.yaml

# With options
./tools/eval-canary/run.sh --config evals/eval.yaml --concurrency 2 --model anthropic/claude-sonnet-4-6

# Compare two existing job_result.json files directly
./tools/eval-canary/compare.sh /tmp/harbor-job/job_result.json /tmp/dspy-job/job_result.json
```

## Thresholds

Override via environment variables:

| Variable                        | Default | Description                                 |
| ------------------------------- | ------- | ------------------------------------------- |
| `CANARY_MAX_SCORE_DRIFT`        | `0.10`  | Max absolute per-scenario reward difference |
| `CANARY_MIN_COMPLETION_RATE`    | `0.90`  | DSPy must achieve at least this             |
| `CANARY_MAX_INFRA_FAILURE_RATE` | `0.05`  | DSPy infra failures must be below this      |

## Verdict

Exit code 0 = PASS (all criteria met), exit code 1 = FAIL.

Pass criteria:

- DSPy completion rate >= threshold
- DSPy completion rate >= Harbor completion rate
- DSPy infra-failure rate <= threshold
- Average absolute score drift <= threshold
