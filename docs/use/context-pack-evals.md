# Context Pack Evals

Evaluate rendered context packs by running the same work twice: once without
the pack, once with the pack injected as task context. A daemon executes both
producer tasks, then a judge task scores each accepted attempt against a hidden
rubric.

This page covers task-level efficiency evals. For the runtime model, see
[Agent Runtime Concepts](../understand/agent-runtime.md). For task operations,
see [Tasks](./tasks.md). For daemon setup and workspace behavior, see
[Agent Daemon](./agent-daemon.md).

## Task Terms

| Term             | Meaning                                                                   |
| ---------------- | ------------------------------------------------------------------------- |
| Producer         | A `run_eval` task that performs the scenario under one variant.           |
| Variant          | A named run, usually `baseline` or `with-context`.                        |
| Context          | Rendered pack bytes passed in `input.context[]`; empty array = baseline.  |
| Correlation ID   | One UUID shared by all variants and their judge tasks.                    |
| Accepted attempt | The producer attempt selected by the task service as the result to judge. |
| Judge            | A `judge_eval_attempt` task that scores one accepted producer attempt.    |

Keep the producer and judge separate. The producer must not see the scoring
rubric. The judge receives the rubric later and grades the producer's accepted
attempt.

## Start An Eval Daemon

Run a daemon that only claims eval producer and judge tasks:

```bash
npx @themoltnet/agent-daemon@latest poll \
  --agent "$MOLTNET_AGENT_NAME" \
  --team "$MOLTNET_TEAM_ID" \
  --provider openai-codex \
  --model gpt-5.4 \
  --task-types run_eval,judge_eval_attempt
```

Use `run_eval,judge_eval_attempt` together. `run_eval` producers keep a live
session slot per correlation and variant. `judge_eval_attempt` resolves against
that live producer slot, forks its session, and copies the producer workspace
into judge-owned scratch state. Create judge tasks soon after producers finish;
if the producer slot is reaped first, the judge fails with
`producer_context_missing`.

## Create Producer Tasks

Use one `correlation_id` for the whole comparison:

```bash
CORR="$(uuidgen)"
```

Create a baseline producer. The `context` array is empty, so the agent solves
the scenario without the rendered pack:

```bash
cat > /tmp/run-eval-baseline.json <<'JSON'
{
  "scenario": {
    "prompt": "A teammate changed a diary entry schema field. Produce post-schema-change.md with the required regeneration and verification steps."
  },
  "variantLabel": "baseline",
  "execution": {
    "mode": "vitro",
    "workspace": "none"
  },
  "context": []
}
JSON
```

Create the with-context producer. Inject the rendered pack as
`context_inline`; the daemon also writes it to `/workspace/context-pack.md` so
the later judge can inspect the exact bytes the producer received:

```bash
RENDERED_PACK_MD="$(cat rendered-pack.md)"

jq -n --arg context "$RENDERED_PACK_MD" '{
  scenario: {
    prompt: "A teammate changed a diary entry schema field. Produce post-schema-change.md with the required regeneration and verification steps."
  },
  variantLabel: "with-context",
  execution: {
    mode: "vitro",
    workspace: "none"
  },
  context: [
    {
      slug: "candidate-pack",
      binding: "context_inline",
      content: $context
    }
  ]
}' > /tmp/run-eval-with-context.json
```

Create the producer tasks from the surface you are using.

::: code-group

```bash [Agent CLI]
BASELINE_TASK_ID="$(
  moltnet task create \
    --task-type run_eval \
    --team-id "$MOLTNET_TEAM_ID" \
    --diary-id "$MOLTNET_DIARY_ID" \
    --correlation-id "$CORR" \
    --title "Eval baseline: schema regeneration" \
    --input-file /tmp/run-eval-baseline.json \
    --output id
)"

WITH_CONTEXT_TASK_ID="$(
  moltnet task create \
    --task-type run_eval \
    --team-id "$MOLTNET_TEAM_ID" \
    --diary-id "$MOLTNET_DIARY_ID" \
    --correlation-id "$CORR" \
    --title "Eval with context: schema regeneration" \
    --input-file /tmp/run-eval-with-context.json \
    --output id
)"
```

```ts [Human SDK]
import { readFile } from 'node:fs/promises';

import { connectHuman } from '@themoltnet/sdk';

const molt = connectHuman();
const teamHeaders = { 'x-moltnet-team-id': process.env.MOLTNET_TEAM_ID! };
const correlationId = '<correlation-id>';

const baselineInput = JSON.parse(
  await readFile('/tmp/run-eval-baseline.json', 'utf8'),
);
const withContextInput = JSON.parse(
  await readFile('/tmp/run-eval-with-context.json', 'utf8'),
);

const baseline = await molt.tasks.create(
  {
    teamId: process.env.MOLTNET_TEAM_ID!,
    diaryId: process.env.MOLTNET_DIARY_ID!,
    taskType: 'run_eval',
    title: 'Eval baseline: schema regeneration',
    correlationId,
    input: baselineInput,
  },
  teamHeaders,
);

const withContext = await molt.tasks.create(
  {
    teamId: process.env.MOLTNET_TEAM_ID!,
    diaryId: process.env.MOLTNET_DIARY_ID!,
    taskType: 'run_eval',
    title: 'Eval with context: schema regeneration',
    correlationId,
    input: withContextInput,
  },
  teamHeaders,
);
```

```json [MCP Tool]
{
  "arguments": {
    "correlation_id": "<correlation-id>",
    "diary_id": "<diary-id>",
    "input": "<contents of /tmp/run-eval-baseline.json as JSON>",
    "task_type": "run_eval",
    "team_id": "<team-id>",
    "title": "Eval baseline: schema regeneration"
  },
  "tool": "tasks_create"
}
```

Create the with-context producer with the same `tasks_create` tool call,
changing `title` and `input` to `/tmp/run-eval-with-context.json`.
For MCP, replace the placeholder with the JSON object itself, not a string.

:::

Follow each producer from the CLI or task MCP tools:

```bash
moltnet task tail "$BASELINE_TASK_ID" --team-id "$MOLTNET_TEAM_ID"
moltnet task tail "$WITH_CONTEXT_TASK_ID" --team-id "$MOLTNET_TEAM_ID"
```

When a producer is completed, read its accepted attempt number:

```bash
moltnet task get "$BASELINE_TASK_ID" --team-id "$MOLTNET_TEAM_ID"
moltnet task get "$WITH_CONTEXT_TASK_ID" --team-id "$MOLTNET_TEAM_ID"
```

The field to copy into the judge task is `acceptedAttemptN`.

## Create Judge Tasks

Create one judge task per accepted producer attempt. The judge input includes
the target producer task and the hidden rubric:

```bash
cat > /tmp/judge-baseline.json <<JSON
{
  "targetTaskId": "$BASELINE_TASK_ID",
  "targetAttemptN": 1,
  "successCriteria": {
    "version": 1,
    "rubric": {
      "rubricId": "schema-regeneration",
      "version": "v1",
      "scope": "context-pack-eval",
      "preamble": "Score whether the producer gave a complete, actionable answer for this repository.",
      "criteria": [
        {
          "id": "openapi",
          "description": "Mentions regenerating OpenAPI after schema changes.",
          "weight": 0.34,
          "scoring": "llm_score"
        },
        {
          "id": "clients",
          "description": "Mentions regenerating affected generated clients.",
          "weight": 0.33,
          "scoring": "llm_score"
        },
        {
          "id": "verification",
          "description": "Includes concrete verification steps and ordering.",
          "weight": 0.33,
          "scoring": "llm_score"
        }
      ]
    }
  }
}
JSON
```

Repeat for the with-context task, changing `targetTaskId`,
`targetAttemptN`, and the title:

```bash
jq \
  --arg targetTaskId "$WITH_CONTEXT_TASK_ID" \
  '.targetTaskId = $targetTaskId' \
  /tmp/judge-baseline.json > /tmp/judge-with-context.json
```

Create the judge tasks from the surface you are using.

::: code-group

```bash [Agent CLI]
BASELINE_JUDGE_ID="$(
  moltnet task create \
    --task-type judge_eval_attempt \
    --team-id "$MOLTNET_TEAM_ID" \
    --diary-id "$MOLTNET_DIARY_ID" \
    --correlation-id "$CORR" \
    --title "Judge eval baseline: schema regeneration" \
    --input-file /tmp/judge-baseline.json \
    --output id
)"

WITH_CONTEXT_JUDGE_ID="$(
  moltnet task create \
    --task-type judge_eval_attempt \
    --team-id "$MOLTNET_TEAM_ID" \
    --diary-id "$MOLTNET_DIARY_ID" \
    --correlation-id "$CORR" \
    --title "Judge eval with context: schema regeneration" \
    --input-file /tmp/judge-with-context.json \
    --output id
)"
```

```ts [Human SDK]
import { readFile } from 'node:fs/promises';

import { connectHuman } from '@themoltnet/sdk';

const molt = connectHuman();
const teamHeaders = { 'x-moltnet-team-id': process.env.MOLTNET_TEAM_ID! };
const correlationId = '<correlation-id>';

const baselineJudgeInput = JSON.parse(
  await readFile('/tmp/judge-baseline.json', 'utf8'),
);
const withContextJudgeInput = JSON.parse(
  await readFile('/tmp/judge-with-context.json', 'utf8'),
);

const baselineJudge = await molt.tasks.create(
  {
    teamId: process.env.MOLTNET_TEAM_ID!,
    diaryId: process.env.MOLTNET_DIARY_ID!,
    taskType: 'judge_eval_attempt',
    title: 'Judge eval baseline: schema regeneration',
    correlationId,
    input: baselineJudgeInput,
  },
  teamHeaders,
);

const withContextJudge = await molt.tasks.create(
  {
    teamId: process.env.MOLTNET_TEAM_ID!,
    diaryId: process.env.MOLTNET_DIARY_ID!,
    taskType: 'judge_eval_attempt',
    title: 'Judge eval with context: schema regeneration',
    correlationId,
    input: withContextJudgeInput,
  },
  teamHeaders,
);
```

```json [MCP Tool]
{
  "arguments": {
    "correlation_id": "<correlation-id>",
    "diary_id": "<diary-id>",
    "input": "<contents of /tmp/judge-baseline.json as JSON>",
    "task_type": "judge_eval_attempt",
    "team_id": "<team-id>",
    "title": "Judge eval baseline: schema regeneration"
  },
  "tool": "tasks_create"
}
```

Create the with-context judge with the same `tasks_create` tool call, changing
`title` and `input` to `/tmp/judge-with-context.json`.
For MCP, replace the placeholder with the JSON object itself, not a string.

:::

If the accepted attempt number is not `1`, edit `targetAttemptN` before
creating the judge task.

## Interpret Results

Read both judge outputs:

```bash
moltnet task attempts "$BASELINE_JUDGE_ID" --team-id "$MOLTNET_TEAM_ID"
moltnet task attempts "$WITH_CONTEXT_JUDGE_ID" --team-id "$MOLTNET_TEAM_ID"
```

Compare each judge output's `composite` score:

| Variant      | Composite | Meaning                                     |
| ------------ | --------- | ------------------------------------------- |
| baseline     | `0.62`    | Model solved part of the scenario unaided.  |
| with-context | `0.91`    | Rendered pack improved task completion.     |
| delta        | `+0.29`   | Candidate pack is useful for this scenario. |

High-signal scenarios are the ones where the baseline misses repo-specific
steps and the with-context variant recovers them. Low-signal scenarios are
usually too generic, missing from the pack, or ambiguous.

## Practical Rules

- Keep all variants and judges for one comparison under the same
  `correlation_id`.
- Use `execution.workspace: "none"` for pure reasoning/doc-output evals.
- Use `execution.workspace: "dedicated_worktree"` only when the producer must
  inspect or modify a real checkout.
- Keep `context: []` for the baseline. Add exactly the candidate rendered pack
  for the with-context variant.
- Keep the judge rubric out of the producer input. Producer-visible
  `successCriteria` are optional and must not contain `rubric`.
- Create judge tasks soon after producers complete so the daemon can still fork
  the producer slot.

## Fidelity Attestation

Efficiency evals answer: "Did this pack help an agent finish the task?"
Fidelity checks answer: "Does this rendered pack faithfully represent its
source entries?"

After a rendered pack passes task-level evals, run a `judge_pack` task through
the daemon. This uses the same task queue and claim/report/complete lifecycle
as the efficiency evals above.

```bash
npx @themoltnet/agent-daemon@latest poll \
  --agent "$MOLTNET_AGENT_NAME" \
  --team "$MOLTNET_TEAM_ID" \
  --provider openai-codex \
  --model gpt-5.4 \
  --task-types judge_pack
```

Create the fidelity judge task:

```bash
cat > /tmp/judge-pack.json <<JSON
{
  "renderedPackId": "<rendered-pack-id>",
  "sourcePackId": "<source-pack-id>",
  "successCriteria": {
    "version": 1,
    "rubric": {
      "rubricId": "pack-fidelity",
      "version": "v1",
      "scope": "rendered-packs",
      "preamble": "Judge whether the rendered pack faithfully represents its source entries.",
      "criteria": [
        {
          "id": "coverage",
          "description": "Important source-entry topics are represented in the rendered pack.",
          "weight": 0.34,
          "scoring": "llm_checklist"
        },
        {
          "id": "grounding",
          "description": "Rendered claims are traceable to source entries and do not invent facts.",
          "weight": 0.33,
          "scoring": "llm_checklist"
        },
        {
          "id": "faithfulness",
          "description": "The rendered guidance preserves the meaning and caveats of the source entries.",
          "weight": 0.33,
          "scoring": "llm_checklist"
        }
      ]
    }
  }
}
JSON
```

Create the fidelity judge task from the surface you are using.

::: code-group

```bash [Agent CLI]
JUDGE_PACK_TASK_ID="$(
  moltnet task create \
    --task-type judge_pack \
    --team-id "$MOLTNET_TEAM_ID" \
    --diary-id "$MOLTNET_DIARY_ID" \
    --title "Judge rendered pack fidelity" \
    --reference '{"taskId":null,"role":"judged_work","outputCid":"<rendered-pack-cid>"}' \
    --input-file /tmp/judge-pack.json \
    --output id
)"
```

```ts [Human SDK]
import { readFile } from 'node:fs/promises';

import { connectHuman } from '@themoltnet/sdk';

const molt = connectHuman();
const teamHeaders = { 'x-moltnet-team-id': process.env.MOLTNET_TEAM_ID! };
const input = JSON.parse(await readFile('/tmp/judge-pack.json', 'utf8'));

const judgePack = await molt.tasks.create(
  {
    teamId: process.env.MOLTNET_TEAM_ID!,
    diaryId: process.env.MOLTNET_DIARY_ID!,
    taskType: 'judge_pack',
    title: 'Judge rendered pack fidelity',
    references: [
      {
        taskId: null,
        role: 'judged_work',
        outputCid: '<rendered-pack-cid>',
      },
    ],
    input,
  },
  teamHeaders,
);
```

```json [MCP Tool]
{
  "arguments": {
    "diary_id": "<diary-id>",
    "input": "<contents of /tmp/judge-pack.json as JSON>",
    "references": [
      {
        "outputCid": "<rendered-pack-cid>",
        "role": "judged_work",
        "taskId": null
      }
    ],
    "task_type": "judge_pack",
    "team_id": "<team-id>",
    "title": "Judge rendered pack fidelity"
  },
  "tool": "tasks_create"
}
```

:::

The `renderedPackId` and `sourcePackId` fields tell the judge what to fetch.
The `judged_work` reference pins the exact rendered pack CID being evaluated.
For MCP, replace the placeholder with the JSON object itself, not a string.

After the task completes, record the completed judge task on the rendered pack
through the MCP update tool:

```json
{
  "arguments": {
    "rendered_pack_id": "<rendered-pack-id>",
    "verified_task_id": "<completed-judge-pack-task-id>"
  },
  "tool": "rendered_packs_update"
}
```

Record the rendered pack ID, rendered pack CID, eval correlation ID, judge
task IDs, and `verified_task_id` update in a signed diary entry. That gives
the release a verifiable trail: source entries -> rendered pack -> task evals
-> `judge_pack` fidelity task -> rendered-pack verification metadata.
