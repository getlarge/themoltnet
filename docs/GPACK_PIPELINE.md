# gpack Pipeline

## Purpose

`gpack` optimizes LeGreffier task-time context for coding tasks using GEPA.

Today that context is injected through `.legreffier/context/session-pack.md`,
but that file-based package should be treated as an evaluation/runtime helper,
not the canonical long-term storage model.

This document is the single source of truth for:

- eval input format and validation
- execution/evaluation flow
- optimization loop behavior
- current boundaries (what is implemented vs deferred)

## Scope and Status

Implemented now:

- GEPA-driven context-pack optimization (`tools/src/gpack/pipeline.ts`)
- worktree-based task execution and scoring (`tools/src/gpack/evaluate.ts`)
- GEPA adapter + reflective dataset generation (`tools/src/gpack/adapter.ts`)
- runtime schema validation of eval inputs via TypeBox

Intentionally deferred:

- canonical storage model for optimized packs
- immutable traceability links between packs and source entries
- promotion/writeback workflow contract

Likely direction:

- persisted `context_packs` become the canonical runtime artifact
- agents load packs on demand through the API
- local `.legreffier/context/` files remain a temporary compatibility layer for
  evals and file-oriented runtimes

Those deferred parts are tracked in:

- `docs/research/entry-relations-flywheel-synthesis.md`
- `docs/plans/2026-03-07-entry-relations-context-pipeline-proposal.md`
- `docs/DIARY_ENTRY_STATE_MODEL.md`

## Key Concepts

### `fixture.ref`

`fixture.ref` in `evals/<name>/scenario.json` is the git revision used as the
baseline snapshot for evaluation.

Why it exists:

- each candidate pack is tested from the same repo state
- scores are comparable across GEPA trials
- runs are reproducible

Where used:

- parsed into `GpackTask.baseCommit`
- checked out by `git worktree add <worktree> <baseCommit>` in evaluator

### Task model (`GpackTask`)

A task evaluated by gpack includes:

- `id`: eval/task identifier
- `baseCommit`: from `fixture.ref`
- `problemStatement`: content of `task.md`
- `failToPass`: commands that must pass to score progress
- `passToPass`: regression commands that must remain passing
- `setup`: setup commands (e.g. install/build prerequisites)

## Eval Inputs

Each eval lives in:

```text
evals/<name>/
  scenario.json
  task.md
  criteria.json   (optional, for richer eval traces)
```

`scenario.json` currently uses:

- `fixture.ref` (required)
- `setup.commands` (optional)
- `validation.commands` (required, non-empty)
- `validation.pass_to_pass` or `validation.regression_commands` (optional)
- `context_variants.combined` (optional, used for seed pack compilation)

## Runtime Validation (TypeBox)

Before optimization starts, gpack validates:

- `scenario.json` shape
- non-empty `task.md`
- derived `GpackTask` shape

Validation is implemented in `tools/src/gpack/pipeline.ts` using:

- `@sinclair/typebox`
- `Value.Check` + `Value.Errors`

Failure behavior:

- fail fast before any GEPA trial
- emit path-based error messages (`[gpack] <eval>: <path> <message>`)

## End-to-End Flow

1. Parse CLI args (`--eval`, `--diary-id`, `--num-trials`, `--max-evals`, etc.)
2. Resolve eval set:
   - single eval name
   - comma-separated eval names
   - `all` (all eval directories)
3. Load and validate each eval input
4. Build `GpackTask[]`
5. Resolve diary ID (`--diary-id` > `MOLTNET_DIARY_ID` > diary named after repo)
6. Compile seed pack via `compileDiary` (if not baseline)
7. Initialize GEPA program and seed instruction with seed pack
8. Run GEPA optimization with `MoltNetContextAdapter`
9. Save best pack to `evals/runs/gpack-optimized-<timestamp>.md`
10. Run final evaluation pass on canonical tasks and print per-task/avg scores

## Evaluation Mechanics

Per task evaluation (`evaluateTask`) does:

1. create isolated git worktree at `baseCommit`
2. run `setup` commands (captured; setup failure returns score 0 with trace)
3. write `eval-task.md`
4. inject candidate pack into `.legreffier/context/session-pack.md` (if non-empty)
   as temporary runtime scaffolding
5. run Claude task step (`--permission-mode acceptEdits`)
6. run `failToPass` and `passToPass` commands
7. optional eval rubric step using `criteria.json`
8. compute score:
   - base: fraction of `failToPass` that passed
   - regression penalty: if any `passToPass` fails, score capped at `0.5`
9. cleanup worktree

## GEPA Adapter Behavior

`MoltNetContextAdapter` bridges GEPA candidate text to real task outcomes.

- candidate pack source: `candidate.instruction`
- batch output: per-task score + optional trajectories
- reflection dataset includes:
  - setup failures
  - task-step failure marker
  - failed validation outputs
  - failed regression outputs
  - optional rubric summary

This gives GEPA actionable feedback instead of raw pass/fail only.

## Baseline Mode

`--baseline` skips seed compilation/optimization and evaluates empty pack.

Use baseline to quantify context contribution before tuning.

## Commands

Examples:

```bash
# `.env.local` at repo root is loaded automatically if present.

# Baseline (single eval)
pnpm gpack --eval add-rest-api-route --baseline

# Optimize one eval
MOLTNET_DIARY_ID=<uuid> OPENAI_API_KEY=<key> \
  pnpm gpack --eval add-rest-api-route --num-trials 8 --max-evals 30

# Optimize multiple evals together
MOLTNET_DIARY_ID=<uuid> OPENAI_API_KEY=<key> \
  pnpm gpack --eval add-rest-api-route,add-mcp-tool

# Optimize all eval directories
MOLTNET_DIARY_ID=<uuid> OPENAI_API_KEY=<key> \
  pnpm gpack --eval all
```

## Eval Catalog

Current eval scenarios:

| Eval                    | Task                                                        | Primary knowledge under test                                           |
| ----------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| `add-rest-api-route`    | Add `GET /agents/:agentId/public-key`                       | `rest-api/wiring`, `auth/flow`, `testing/conventions`                  |
| `add-mcp-tool`          | Add `agent_public_key` MCP tool                             | `mcp-server/wiring`, `testing/conventions`                             |
| `fix-keto-cleanup`      | Fix orphaned DiaryEntry Keto tuples (#382)                  | `auth/flow`, `database/schema-and-access`, `testing/conventions`       |
| `regen-api-clients`     | Regenerate all API clients after route change               | `api-generation/pipeline`, `go-client/workflow`                        |
| `add-dbos-dedup-queues` | Add dedup to consolidate/compile via two-queue DBOS pattern | `rest-api/wiring`, `database/schema-and-access`, `testing/conventions` |

## Context Variants (run-eval)

These are used primarily by `tools/src/run-eval.ts` for one-shot benchmarking.
`gpack` currently uses the `combined` config as seed context input.

| Variant        | Context source                     | What it tests                           |
| -------------- | ---------------------------------- | --------------------------------------- |
| `baseline`     | none                               | model behavior without injected context |
| `scan_tiles`   | `diaries_compile` over tile tags   | subsystem-level conventions             |
| `gold_nuggets` | `diaries_compile` over nugget tags | atomic operational rules                |
| `combined`     | tiles + nuggets (multi layer)      | layered context quality                 |

## run-eval (one-shot benchmark)

`run-eval` is still useful for measuring explicit context variants outside GEPA:

```bash
# Run all variants for one eval
npx tsx tools/src/run-eval.ts evals/add-rest-api-route

# Run one variant
npx tsx tools/src/run-eval.ts evals/add-rest-api-route baseline
```

## Adding New Evals

Good candidates:

- tasks requiring non-obvious repo conventions (registration order, auth flow, helper selection)
- tasks where codebase style and test idioms materially affect solution quality
- tasks with deterministic command-based validation (`typecheck`, unit tests)

Avoid for first-pass evals:

- tasks requiring full E2E Docker environments for pass/fail
- tasks where correctness cannot be tied to concrete command outcomes

## Criteria Authoring Standard (HITL-first)

Most reliable process:

1. Solve the task with full human context and verify validation commands pass.
2. Write criteria from the confirmed-good solution (falsifiable checks only).
3. Adversarially probe criteria against plausible wrong implementations.
4. Set `fixture.ref` to the commit immediately before the golden solution.

If baseline and context variants fail identically, review criteria quality before
concluding context quality is poor.

## Current Constraints

- Task execution still depends on external `claude` CLI availability.
- Optimization cost scales with number of metric calls and tasks.
- Output is currently a local markdown artifact, not yet a finalized promoted
  diary entry lifecycle.

## Source Files

- `tools/src/gpack/pipeline.ts`
- `tools/src/gpack/evaluate.ts`
- `tools/src/gpack/adapter.ts`
- `evals/*/scenario.json`
