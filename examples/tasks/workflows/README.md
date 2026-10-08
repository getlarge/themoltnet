# Chain generation and classification tasks

A task uses one runtime-profile capability. `freeform` selects
`models.generation`; `classify` selects `models.classification`. Both run through
Pi once the classification executor in the following stack layer is deployed,
so the classification selection must name a Pi-compatible language model.
The classifier is a separate task with a structured answer, not a model switch
inside a generation session.

The script demonstrates two handoffs:

| Workflow                 | Handoff                                                                                                                                               |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `generate-then-classify` | A `freeform` task produces `result.draft`; a `classify` task receives that sentence as `state.text` and returns an urgency choice with probabilities. |
| `classify-then-generate` | A `classify` task returns an urgency choice; a `freeform` task receives the validated choice in its brief and produces `result.draft`.                |

Each stage waits for a completed task with an accepted attempt, validates the
field it passes onward, and stops if the task fails, is cancelled, expires, or
takes longer than ten minutes. Both tasks share a correlation ID. They can use
the same runtime profile if it contains both capabilities, or separate profiles
with the required capability. A daemon able to claim each profile must be
running with classification execution support. PR #2658 adds the task contract
and capability selection, but cannot yet execute a `classify` task on its own.
The script creates real tasks and waits for their outputs; use a test team and
diary when trying it after the full stack is deployed.

From the repository root, with the released `moltnet` CLI, `jq`, and `uuidgen`
available:

```bash
export TEAM_ID=<team-uuid>
export DIARY_ID=<diary-uuid>
export GENERATION_PROFILE_ID=<profile-with-generation-uuid>
export CLASSIFICATION_PROFILE_ID=<profile-with-classification-uuid>
export REQUEST_TEXT='The customer cannot sign in and needs access today.'

bash examples/tasks/workflows/chain-model-capabilities.sh generate-then-classify
bash examples/tasks/workflows/chain-model-capabilities.sh classify-then-generate
```

Set `CORRELATION_ID` to a UUID if you want to supply the grouping key; otherwise
the script creates one for each run. The first stage owns the output contract;
the second stage receives only the validated handoff value. For larger results,
pass an immutable task artifact CID instead of copying the content into
`classify.state`. For crash-safe production orchestration, use
[`@themoltnet/tasks-orchestrator`](../../../libs/tasks-orchestrator/README.md)
with `createTaskStep` and `waitForAcceptedTask`; the script is an executable
teaching example.
