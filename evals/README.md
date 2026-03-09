# MoltNet Evals

Evaluation scenarios for measuring whether compiled diary context improves agent task quality on real MoltNet coding tasks.

## Structure

```
evals/
├── <eval-name>/
│   ├── task.md              # what Claude is asked to do
│   ├── criteria.json        # weighted checklist of pass/fail checks
│   ├── scenario.json        # fixture ref + context variants
│   └── runs/                # eval results (gitignored)
```

## Scenarios

| Eval                    | Task                                                        | Primary tiles tested                                                   |
| ----------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| `add-rest-api-route`    | Add `GET /agents/:agentId/public-key`                       | `rest-api/wiring`, `auth/flow`, `testing/conventions`                  |
| `add-mcp-tool`          | Add `agent_public_key` MCP tool                             | `mcp-server/wiring`, `testing/conventions`                             |
| `fix-keto-cleanup`      | Fix orphaned DiaryEntry Keto tuples (#382)                  | `auth/flow`, `database/schema-and-access`, `testing/conventions`       |
| `regen-api-clients`     | Regenerate all API clients after route change               | `api-generation/pipeline`, `go-client/workflow`                        |
| `add-dbos-dedup-queues` | Add dedup to consolidate/compile via two-queue DBOS pattern | `rest-api/wiring`, `database/schema-and-access`, `testing/conventions` |

## Context variants

Each scenario runs against 4 variants:

| Variant        | Context source                                    | What it tests                                                 |
| -------------- | ------------------------------------------------- | ------------------------------------------------------------- |
| `baseline`     | none                                              | how well Claude does with only the repo code                  |
| `scan_tiles`   | `diaries_compile` scoped to Sonnet tile session   | do subsystem tiles improve convention compliance?             |
| `gold_nuggets` | `diaries_compile` scoped to Sonnet nugget session | do atomic rules improve compliance without full tile context? |
| `combined`     | tiles (2500 tok) + nuggets (1500 tok)             | is the combination better than either alone?                  |

## Running

```bash
# Prerequisites
export MOLTNET_DIARY_ID="e8c6646b-d4bc-47e9-aa6f-52d7d70efade"      # scan-experiment-001 diary
export MOLTNET_CREDENTIALS_PATH=".moltnet/legreffier/moltnet.json"   # agent credentials
# Run all variants for one eval (from repo root)
npx tsx tools/src/run-eval.ts evals/add-rest-api-route

# Run a single variant
npx tsx tools/src/run-eval.ts evals/add-rest-api-route baseline
npx tsx tools/src/run-eval.ts evals/add-rest-api-route scan_tiles

# Results written to evals/<name>/runs/
```

## How it works

1. **Checkout**: creates a git worktree at the scenario's fixture ref
2. **Setup**: runs `pnpm install --frozen-lockfile` in the worktree
3. **Context**: calls `diaries_compile` with the variant's `include_tags` + the task as `task_prompt`, writes output to `.legreffier/context/session-pack.md`
4. **Task**: runs `claude` with the task.md prompt; Claude reads session-pack.md if present
5. **Eval**: runs `claude` to score the solution against criteria.json
6. **Compare**: after all variants, summarizes score differences across variants

## Criteria scoring

Each criterion has:

- `name` — stable ID
- `description` — what to check
- `example` — code evidence to look for
- `category` — `INTENT` (logic), `CONVENTION` (repo patterns), `ARCHITECTURE` (layer rules), `SECURITY` (auth/trust), `TESTING` (test patterns), `RUNTIME` (typecheck/test pass)
- `max_score` — weight (RUNTIME and SECURITY checks are worth 2)

## What to look for in results

- **Criteria that pass in baseline**: Claude knows this without context (probably obvious from code)
- **Criteria that improve with scan_tiles**: subsystem knowledge from tiles is helping
- **Criteria that improve with gold_nuggets only**: atomic rules are more efficient than full tiles for this check
- **Criteria that never pass**: either the task is too hard, or the context is missing something — candidate for a new scan entry or nugget

## Adding new evals

Good candidates are issues where the correct solution requires knowing:

- Plugin/plugin registration order (rest-api, mcp-server)
- Keto write timing (after DB commit, not inside tx)
- Which helper to use (createProblem, textResult, getExecutor)
- Test patterns (AAA, app.inject, explicit vitest imports)
- Security rules (404 not 403, no auth in repo layer)

Avoid tasks that require E2E Docker stack for validation in the first pass — stick to typecheck + unit test verifiable tasks.

## Writing criteria: HITL golden standard

Criteria written purely from an issue spec are unreliable — they may miss subtle semantic requirements (e.g. _where_ in a multi-step flow a value must be placed, not just _that_ it must be used). The result is criteria that a plausible-but-wrong implementation can pass.

The most reliable process:

1. **Solve the task with full human context** — implement the feature with a developer who understands the issue deeply, using full HITL review. Verify it passes all validation commands.
2. **Write criteria from the working solution** — inspect the diff and extract concrete, falsifiable checks grounded in what the correct implementation actually looks like. The `example` field should be a real snippet from the golden solution.
3. **Adversarially probe the criteria** — ask: can a plausible wrong implementation score full marks? If yes, tighten the criterion (usually by being more specific about placement, naming, or data flow).
4. **Fix the fixture ref** — set `scenario.json > fixture.ref` to the commit _before_ the golden solution, so the eval starts from a clean state.

Criteria written by an agent without a golden solution are a starting point only. Treat any criterion that both baseline and context variants fail identically as a signal to review criterion quality, not just context quality.
