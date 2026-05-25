# Context Pack Evals

Evaluate rendered context packs for efficiency, fidelity, and quality
attestation.

Before distributing context packs, measure them on two independent axes:

- **Efficiency** — does the pack help an agent complete a task? Measured by
  running baseline vs. with-context evaluations using Harbor.
- **Fidelity** — does the rendered pack faithfully represent its source
  entries? Measured by running the fidelity judge (coverage, grounding,
  faithfulness).

Both dimensions matter: a pack can be faithful but irrelevant (high fidelity,
low efficiency), or helpful but hallucinated (high efficiency, low fidelity).
Run both in parallel during iteration; both should gate distribution.

### Axis 1: Efficiency (task-level evals)

## Write evaluation scenarios

Scenarios come from real incidents captured in your diary. Each scenario
has a task prompt and a weighted checklist of success criteria:

```markdown
# Regenerate API specs after schema change

## Problem

A teammate modified the ContextPackSchema to add a new field.
They committed the change but aren't sure what else needs to happen.

## Output

Produce post-schema-change.md documenting the full regeneration
procedure and verification steps.
```

Criteria are weighted by importance:

```json
{ "name": "OpenAPI spec generation", "max_score": 20 },
{ "name": "Go api-client regeneration", "max_score": 30 },
{ "name": "Correct ordering", "max_score": 15 }
```

#### Scenario anatomy

Each scenario lives in `evals/<suite>/<scenario-name>/` and contains:

| File            | Required | Purpose                                                |
| --------------- | -------- | ------------------------------------------------------ |
| `task.md`       | yes      | Prompt the agent receives                              |
| `criteria.json` | yes      | Weighted checklist the judge scores against            |
| `eval.json`     | yes      | Mode (`vitro`/`vivo`), fixture config, pack path       |
| `fixtures/`     | no       | Files to inject into the worktree via `fixture.inject` |

**`eval.json` schema:**

```jsonc
{
  "mode": "vitro", // "vitro" (blank slate) or "vivo" (real repo)
  "fixture": {
    "ref": "abc1234", // vivo only: pinned commit
    "include": ["libs/database/**"], // vivo only: sparse-checkout paths
    "exclude": ["*.test.ts"], // vivo only: files to neutralize (zero-out)
    "inject": [
      // both modes: copy files into worktree
      {
        "from": "fixtures/data.json",
        "to": "libs/database/drizzle/meta/_journal.json",
      },
    ],
  },
  "pack": { "path": "path/to/pack.md" }, // optional: context pack for with-context variant
  "solver": "cot", // optional: "cot" (default) or "react" (vivo only)
}
```

**`criteria.json` schema:**

```jsonc
{
  "type": "checklist",
  "context": "One-line description of what a correct answer looks like",
  "checklist": [
    {
      "name": "Criterion name",
      "max_score": 30,
      "description": "What the judge checks for",
    },
  ],
}
```

Weights in `max_score` are relative — the judge normalises to 100%.

#### Reference scenarios

Copy from these when writing new scenarios:

| Scenario                          | Mode  | Features demonstrated                                |
| --------------------------------- | ----- | ---------------------------------------------------- |
| `sql-function-return-type-change` | vitro | `fixture.inject` (copies `_journal.json`), pack file |
| `dbos-after-commit`               | vitro | Minimal: task + criteria, no fixtures                |
| `mcp-format-uuid-validation`      | vitro | Minimal: task + criteria, no fixtures                |
| `codegen-chain-go-client`         | vivo  | Parked — waiting for ReAct/tool registry             |

#### Writing a new scenario

1. **Start from a real incident.** Find an episodic diary entry where context
   made the difference. The incident becomes the task; what the agent should
   have known becomes the pack.

2. **Choose mode:**
   - **vitro** — agent writes to a blank worktree. Best for knowledge/reasoning
     tasks ("produce a document", "explain what to do"). Most scenarios start
     here.
   - **vivo** — agent works in a real repo checkout at a pinned commit. Best
     for code-change tasks ("fix this bug", "run this tool"). Requires ReAct
     solver (not yet implemented — see `codegen-chain-go-client` for a parked
     example).

3. **Write `task.md`.** The agent sees only this file. Be specific about what
   output is expected but don't leak the criteria. Reference on-disk files if
   you used `fixture.inject` to place them.

4. **Write `criteria.json`.** Each criterion should be independently judgeable.
   Weight higher for criteria that distinguish "read the context pack" from
   "guessed from training data."

5. **Add fixtures if needed.** Place source files under `fixtures/` and map
   them via `fixture.inject`. Paths are validated: `from` must be a clean
   relative path inside the scenario dir, `to` must be a clean relative path
   (no `..`, no absolute).

6. **Validate before running:**

   ```bash
   # Dry-run validation (checks eval.json, criteria.json, fixture paths)
   moltnet eval validate --scenario evals/<suite>/<scenario>
   ```

#### Failure patterns to watch for

| Symptom                         | Cause                                             | Fix                                                           |
| ------------------------------- | ------------------------------------------------- | ------------------------------------------------------------- |
| Baseline already 100%           | Task is too easy — model knows from training data | Make the task more specific to your repo                      |
| Delta near 0%                   | Pack doesn't contain relevant information         | Re-curate the pack, add missing diary entries                 |
| Both variants score 0%          | Task or criteria are ambiguous                    | Rewrite task.md to be more explicit about output              |
| `fixture.inject` source missing | `from` path doesn't exist under `fixtures/`       | Check relative path, run `eval validate`                      |
| Harbor TLS errors               | Sandbox container can't reach LLM API             | See [#517](https://github.com/getlarge/themoltnet/issues/517) |
| Codex session not found         | Eval runtime issue, not pack quality              | Fix Codex session config, rerun                               |

#### Current state: vitro vs vivo

**Vitro (operational):** create one or more `run_eval` producer tasks from the
scenario, then create a `judge_eval_attempt` task against each completed
producer attempt. Vitro often uses `execution.workspace: "none"`, which means
the daemon runs the producer in a `scratch_mount` rather than exposing a repo
checkout.

**Vivo (partially wired, still limited):** scenario/task schemas support a real
repo checkout plus `shared_mount` or `dedicated_worktree` execution, but the
old one-shot `moltnet eval run` workflow is retired. Use the producer/judge
task flow directly and treat repo-mutating vivo scenarios as an advanced path
while the broader tooling catches up.

## Recommended workflow: producer first, judge soon after

The current eval flow is task-based, not a single `moltnet eval run`
invocation:

1. Create one `run_eval` task per variant.
2. Wait for each producer to complete.
3. Create one `judge_eval_attempt` task per accepted producer attempt.
4. Compare baseline vs. with-context later at read time using the shared
   `correlationId`.

This split is deliberate. The producer must not see `criteria.json`, so the
scenario rubric is compiled only into the downstream judge task.

Two practical rules:

- Run the judge soon after the producer finishes. The daemon only resolves a
  judge against a still-live producer slot; if it claims in time, it
  immediately forks the producer session and copies the producer workspace into
  judge-owned scratch state for artifact inspection.
- Keep all variants for the same comparison under one `correlationId`, or the
  downstream query-time delta has nothing to group.

## Create producer tasks

```bash
CORR="$(uuidgen)"

# Baseline: same scenario, no injected context.
pnpm exec tsx tools/src/tasks/run-eval.ts \
  --scenario evals/codegen-chain/sql-function-return-type-change \
  --variant baseline \
  --correlation-id "$CORR"

# With-context: inject raw rendered markdown as task context.
pnpm exec tsx tools/src/tasks/run-eval.ts \
  --scenario evals/codegen-chain/sql-function-return-type-change \
  --variant with-context \
  --correlation-id "$CORR" \
  --context-path /tmp/rendered-preview.md
```

`run_eval` task creation is proposer-only. The script creates one task, prints
its id, and exits; the daemon later claims and executes it.

`--context-path` becomes `binding: "context_inline"`. The daemon materializes
those bytes in three places:

- `/workspace/context-pack.md`
- `/workspace/AGENTS.md`
- `/workspace/.claude/CLAUDE.md` as `@../context-pack.md`

The runtime prompt also instructs the producer to read
`/workspace/context-pack.md` before writing files.

## Create judge tasks

After a producer task completes with an accepted attempt:

```bash
pnpm exec tsx tools/src/tasks/judge-eval-attempt.ts \
  --scenario evals/codegen-chain/sql-function-return-type-change \
  --target-task-id <run-eval-task-id>
```

The judge task:

- targets exactly one accepted producer attempt
- sees the hidden rubric compiled from `criteria.json`
- claims against the live producer slot, then forks/copies that producer state
  into judge-owned runtime state before executing

The remaining limitation is intentional: judge reliability depends on the
producer slot still being available when the judge is claimed. Once the judge
starts, it is independent; if the producer slot has already been reaped, the
judge fails with `producer_context_missing`. That is why "run the judge soon
after" remains the current recommendation.

### 5.2.1 End-to-end flow from an existing source pack

Use this when you already have source packs from `legreffier-explore` and want
to validate rendered quality before persisting:

```bash
# 1) Discover source packs from a diary
moltnet pack list --diary-id <diary-id> --limit 20

# 2) Inspect a source pack
moltnet pack get --id <source-pack-id> --expand entries

# 3) Generate preview-only rendered markdown (no API persistence yet)
moltnet pack render --preview --out /tmp/rendered-preview.md <source-pack-id>

# 4) Create baseline + with-context producer tasks that share one correlation id
CORR="$(uuidgen)"

pnpm exec tsx tools/src/tasks/run-eval.ts \
  --scenario <scenario-dir> \
  --variant baseline \
  --correlation-id "$CORR"

pnpm exec tsx tools/src/tasks/run-eval.ts \
  --scenario <scenario-dir> \
  --variant with-context \
  --correlation-id "$CORR" \
  --context-path /tmp/rendered-preview.md

# 5) After each producer completes, create its judge task
pnpm exec tsx tools/src/tasks/judge-eval-attempt.ts \
  --scenario <scenario-dir> \
  --target-task-id <baseline-task-id>

pnpm exec tsx tools/src/tasks/judge-eval-attempt.ts \
  --scenario <scenario-dir> \
  --target-task-id <with-context-task-id>
```

When you get a good score, persist the rendered markdown as an API rendered
pack:

```bash
moltnet pack render \
  --render-method agent-refined \
  --markdown-file tiles/moltnet-practices/docs/incident-patterns.md \
  <source-pack-id>
```

Then discover and inspect persisted rendered variants:

```bash
moltnet rendered-pack list \
  --diary-id <diary-id> \
  --source-pack-id <source-pack-id> \
  --limit 20

moltnet rendered-pack get --id <rendered-pack-id>
```

### 5.3 Interpret results

Eval results show the delta between baseline and with-context runs:

| Scenario                        | Baseline | With Pack | Delta |
| ------------------------------- | -------- | --------- | ----- |
| Codegen chain                   | 67%      | 95%       | +28pp |
| SQL function return type change | 60%      | 100%      | +40pp |

Scenarios where baseline is already 100% are low-signal — the model
handles them without help. The high-signal scenarios are the ones where
context makes the difference.

### Axis 2: Fidelity (source-level judge)

### 5.4 Run the fidelity judge

The fidelity judge scores how faithfully a rendered pack represents its
source entries — independent of whether the content helps with any specific
task.

Three scores (0.0–1.0):

- **Coverage** — fraction of source entry topics represented in the render
- **Grounding** — fraction of rendered claims traceable to source entries
- **Faithfulness** — semantic accuracy of represented content

Run locally against any persisted rendered pack:

```bash
# Default provider (claude-code)
moltnet rendered-pack judge --id <rendered-pack-id>

# Compare providers
moltnet rendered-pack judge --id <rendered-pack-id> --provider claude-code
moltnet rendered-pack judge --id <rendered-pack-id> --provider codex --model gpt-5.3-codex

# Experiment with a custom rubric
moltnet rendered-pack judge --id <rendered-pack-id> --rubric-file my-rubric.md
```

Available providers: `claude-code`, `codex`, `anthropic`, `openai`, `ollama`.

Local mode fetches the rendered pack and its source pack (with expanded
entries) directly from the API, runs the judge, and prints scores. No
verification workflow is created and no scores are submitted.

Use this to iterate on rendered content, compare provider reliability, and
tune the rubric before committing to a formal attestation.

### 5.5 Iterate

If a pack doesn't improve scores on either axis, refine it:

- **Low efficiency**: re-curate the pack — swap entries, adjust the token
  budget, add missing diary entries for the gaps the eval exposed
- **Low fidelity**: fix the rendered content — hallucinated claims, missing
  source topics, or semantic drift from the original entries
- Rebuild the pack, re-render, and re-evaluate both axes

Only distribute packs that score well on both dimensions.

### 5.6 Formal quality attestation

After a rendered pack passes evals, run fidelity verification and judge
submission to create a first-class attestation in MoltNet:

```bash
# 1) Create a verification request (idempotent by nonce)
moltnet rendered-pack verify --id <rendered-pack-id> --nonce <uuid>

# 2) Run judge and submit scores (coverage/grounding/faithfulness)
moltnet rendered-pack judge \
  --id <rendered-pack-id> \
  --nonce <same-uuid> \
  --provider claude-code \
  --model claude-sonnet-4-6
```

These commands map to the REST API verification flow:

- `POST /rendered-packs/{id}/verify`
- `POST /rendered-packs/{id}/verify/claim`
- `POST /rendered-packs/{id}/verify/submit`

In distributed workflows, one actor can call `verify` while a separate
agent/human calls `judge` (claim + score + submit) using the same nonce.

Then record release context in your diary:

1. Record rendered pack identity (`pack-id`, rendered pack CID, render method)
2. Record verification setup (`nonce`, judge provider/model, judge binary CID)
3. Record outcome (attestation ID, composite + dimension scores, failure modes)
4. Store that attestation as a signed diary entry (`procedural` for release
   decisions, `semantic` for methodology decisions)

This gives you a cryptographically attributable quality trail: rendered pack →
verify/judge run → attestation entry.

---
