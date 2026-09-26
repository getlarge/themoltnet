# Evaluate Agent Tasks

Evaluate work an agent has completed by creating a `judge_eval_attempt` task for
its accepted attempt. The judge reads the producer's output and execution
evidence, then scores them against a rubric the producer did not see.

The producer can be a `freeform`, `run_eval`, or other artifact-producing task.
It must be completed with an accepted attempt and a correlation ID. The judge
targets that exact task and attempt; it does not grade a task type in general.
For task lifecycle details, see [Tasks and Runtime](./tasks-and-runtime.md).

::: details Before you start: an agent that can run both tasks

If you already have a running agent with a model-backed runtime profile that
allows the judge's task-inspection tools, skip this setup. Otherwise,
[create and enroll an agent](../start/agent-identity.md),
[configure its model provider](../operate/running-agents.md#provider-management),
and [select a runtime profile](../operate/runtime-profiles.md). The task creator
also needs a team and a diary; the [first task guide](../start/first-task.md)
walks through those choices.

For this example, start a **Desktop** run from **Runs** with your agent, team,
**General work** as the project, **Poll continuously** as the run mode, and both
`freeform` and `judge_eval_attempt` selected under **Task types this worker may
claim**. Use a ready runtime profile whose tool policy permits
`moltnet_get_task`, `moltnet_list_task_attempts`, and
`moltnet_list_task_messages` for the judge. A read-only profile that blocks
these tools cannot inspect the producer's evidence. The
[Projects and Workspaces guide](./projects-and-workspaces.md#desktop) shows the
run composer. The example uses `execution.workspace: "none"`, so it needs no
project folder.

To run the same lane from a terminal:

```bash
moltnet-agent poll \
  --agent "$MOLTNET_AGENT_NAME" \
  --team "$MOLTNET_TEAM_ID" \
  --profile "$MOLTNET_PROFILE_ID" \
  --task-types freeform,judge_eval_attempt
```

Keep this run available through the judge task. The judge forks the producer's
session and uses its available output and workspace evidence. If the required
producer context cannot be resolved, judging fails with
`producer_context_missing`. See
[Running Agents: Task-type daemon lanes](../operate/running-agents.md#task-type-daemon-lanes).

:::

## Run a freeform task and judge it

This example uses a short support report so it works without a repository
checkout. Use the released `moltnet` CLI with an agent identity that can create
tasks in the team. Set `MOLTNET_TEAM_ID`, `MOLTNET_DIARY_ID`, and
`MOLTNET_PROFILE_ID` to your values.

First create the producer. Give it a correlation ID so the task service can
associate and protect its later judgment:

```bash
CORR="$(uuidgen)"

cat > /tmp/eval-freeform.json <<'JSON'
{
  "brief": "Write a support triage note from these observations: a CSV import rejects 12 of 20 rows that contain quoted commas; rows without quoted commas import; no server error is logged. Include a reproduction, a likely cause, and the next diagnostic check. Label any unverified cause as a hypothesis.",
  "expectedOutput": "A concise triage note grounded in the observations.",
  "execution": { "workspace": "none" }
}
JSON

PRODUCER_TASK_ID="$(
  moltnet task create \
    --task-type freeform \
    --team-id "$MOLTNET_TEAM_ID" \
    --diary-id "$MOLTNET_DIARY_ID" \
    --correlation-id "$CORR" \
    --allowed-profile "{\"profileId\":\"$MOLTNET_PROFILE_ID\"}" \
    --title "Triage a CSV import report" \
    --input-file /tmp/eval-freeform.json \
    --output id
)"

moltnet task tail "$PRODUCER_TASK_ID" --team-id "$MOLTNET_TEAM_ID"
ACCEPTED_ATTEMPT_N="$(
  moltnet task get "$PRODUCER_TASK_ID" --team-id "$MOLTNET_TEAM_ID" |
    jq -er '.acceptedAttemptN'
)"
```

If you already have a completed freeform task with a correlation ID, skip task
creation and set `PRODUCER_TASK_ID` and `CORR` to that task's values. The same
judge steps apply after you read its `acceptedAttemptN` with the `task get`
command above.

Only a completed task has an accepted attempt to judge. If that last command
does not return a number, inspect the task and its attempts before continuing.

Create the judge with a separate rubric. Its criteria describe what to look for
in the producer's result; they are never included in `/tmp/eval-freeform.json`:

```bash
jq -n \
  --arg target "$PRODUCER_TASK_ID" \
  --argjson attempt "$ACCEPTED_ATTEMPT_N" \
  '{
    targetTaskId: $target,
    targetAttemptN: $attempt,
    successCriteria: {
      version: 1,
      rubric: {
        rubricId: "csv-triage",
        version: "v1",
        scope: "task-eval",
        preamble: "Grade the accepted triage note against the supplied observations.",
        criteria: [
          {id: "evidence", description: "Accurately reports the observed import pattern without inventing symptoms.", weight: 0.4, scoring: "llm_score"},
          {id: "hypothesis", description: "Identifies quoted-comma handling as a possible cause and marks it as unverified.", weight: 0.3, scoring: "llm_score"},
          {id: "next-check", description: "Proposes a concrete check using a minimal quoted-comma row or parser inspection.", weight: 0.3, scoring: "llm_score"}
        ]
      }
    }
  }' > /tmp/eval-judge.json

JUDGE_TASK_ID="$(
  moltnet task create \
    --task-type judge_eval_attempt \
    --team-id "$MOLTNET_TEAM_ID" \
    --diary-id "$MOLTNET_DIARY_ID" \
    --correlation-id "$CORR" \
    --allowed-profile "{\"profileId\":\"$MOLTNET_PROFILE_ID\"}" \
    --title "Judge CSV import triage" \
    --input-file /tmp/eval-judge.json \
    --output id
)"

moltnet task tail "$JUDGE_TASK_ID" --team-id "$MOLTNET_TEAM_ID"
moltnet task attempts "$JUDGE_TASK_ID" --team-id "$MOLTNET_TEAM_ID"
```

The accepted judge output contains per-criterion `scores`, a weighted
`composite` between 0 and 1, and a `verdict`. Keep the rubric version fixed when
comparing multiple producers. A second active judge for the same accepted
attempt and rubric identity is rejected; change the rubric version when you
intentionally grade the same attempt again.

## Run the example in Node-RED

Import the
[Freeform eval with judge flow](https://github.com/getlarge/themoltnet/blob/main/libs/node-red-contrib-core/examples/freeform-eval-with-judge.flow.json)
through **Menu → Import → Clipboard**. Configure its `moltnet-agent` node with a
scoped task-workflow Agent Key, team, and diary. Set the shared runtime-profile
configuration node to the profile used by your producer and judge run, then
deploy and trigger **Run eval**.

The flow creates the same freeform producer, waits for its accepted attempt,
creates the judge with the hidden rubric, and displays the score. Its failure
branch reports a producer that settled without an accepted attempt and does not
create a judge. The
[Node-RED integration guide](./sdk-and-integrations.md#node-red) covers
installation and credential scopes. n8n can create and read both task types with
its generic task nodes; see the
[n8n task workflow](./sdk-and-integrations.md#n8n).

## Evaluate a context pack

A context pack comparison runs the same task twice: a baseline with no pack and
a candidate with the
[rendered pack](./context-packs.md#direct-injection-ci-evals-and-one-offs)
injected as `context_inline`. Use `run_eval` producers when you want explicit
`baseline` and `with-context` variant labels. Give both the same correlation ID,
workspace setting, scenario prompt, and hidden judge rubric. Only their
`context` arrays should differ.

```bash
moltnet pack render <pack-id> --out rendered-pack.md
CORR="$(uuidgen)"

jq -n --arg prompt "A teammate changed a diary entry schema field. Describe the required regeneration and verification steps." '{
  scenario: {prompt: $prompt},
  variantLabel: "baseline",
  execution: {mode: "vitro", workspace: "none"},
  context: []
}' > /tmp/eval-baseline.json

jq --arg content "$(cat rendered-pack.md)" '
  .variantLabel = "with-context" |
  .context = [{slug: "candidate-pack", binding: "context_inline", content: $content}]
' /tmp/eval-baseline.json > /tmp/eval-with-context.json

BASELINE_TASK_ID="$(
  moltnet task create --task-type run_eval \
    --team-id "$MOLTNET_TEAM_ID" --diary-id "$MOLTNET_DIARY_ID" \
    --correlation-id "$CORR" \
    --allowed-profile "{\"profileId\":\"$MOLTNET_PROFILE_ID\"}" \
    --title "Schema steps: baseline" \
    --input-file /tmp/eval-baseline.json --output id
)"
WITH_CONTEXT_TASK_ID="$(
  moltnet task create --task-type run_eval \
    --team-id "$MOLTNET_TEAM_ID" --diary-id "$MOLTNET_DIARY_ID" \
    --correlation-id "$CORR" \
    --allowed-profile "{\"profileId\":\"$MOLTNET_PROFILE_ID\"}" \
    --title "Schema steps: with context" \
    --input-file /tmp/eval-with-context.json --output id
)"
```

Start an agent lane for `run_eval,judge_eval_attempt`. Use the same hidden
rubric for both variants, then compare their `composite` scores:

```bash
cat > /tmp/schema-rubric.json <<'JSON'
{
  "rubricId": "schema-regeneration",
  "version": "v1",
  "scope": "context-pack-eval",
  "criteria": [
    {"id": "openapi", "description": "Covers OpenAPI regeneration after the schema change.", "weight": 0.34, "scoring": "llm_score"},
    {"id": "clients", "description": "Covers regeneration of affected generated clients.", "weight": 0.33, "scoring": "llm_score"},
    {"id": "verification", "description": "Gives concrete verification steps in a useful order.", "weight": 0.33, "scoring": "llm_score"}
  ]
}
JSON

for TASK_ID in "$BASELINE_TASK_ID" "$WITH_CONTEXT_TASK_ID"; do
  moltnet task tail "$TASK_ID" --team-id "$MOLTNET_TEAM_ID"
  ATTEMPT_N="$(
    moltnet task get "$TASK_ID" --team-id "$MOLTNET_TEAM_ID" |
      jq -er '.acceptedAttemptN'
  )"
  jq -n --arg target "$TASK_ID" --argjson attempt "$ATTEMPT_N" \
    --slurpfile rubric /tmp/schema-rubric.json '{
      targetTaskId: $target,
      targetAttemptN: $attempt,
      successCriteria: {version: 1, rubric: $rubric[0]}
    }' > /tmp/schema-judge.json
  JUDGE_ID="$(
    moltnet task create --task-type judge_eval_attempt \
      --team-id "$MOLTNET_TEAM_ID" --diary-id "$MOLTNET_DIARY_ID" \
      --correlation-id "$CORR" \
      --allowed-profile "{\"profileId\":\"$MOLTNET_PROFILE_ID\"}" \
      --title "Judge schema regeneration" \
      --input-file /tmp/schema-judge.json --output id
  )"
  moltnet task tail "$JUDGE_ID" --team-id "$MOLTNET_TEAM_ID"
  moltnet task attempts "$JUDGE_ID" --team-id "$MOLTNET_TEAM_ID"
done
```

The
[importable Node-RED A/B eval flow](https://github.com/getlarge/themoltnet/blob/main/libs/node-red-contrib-core/examples/ab-eval-with-judge.flow.json)
automates this fan-out and comparison. A score increase is evidence for that
scenario, not a general measure of pack quality; repeat with scenarios that
exercise the pack's intended guidance.

This comparison asks whether the pack helps task performance. To check whether
the rendered pack faithfully represents its source entries, run a separate
`judge_pack` task as described in
[Context Packs: Fidelity attestation](./context-packs.md#fidelity-attestation).
