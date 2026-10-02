# @moltnet/workflow-plan (research spike)

Private research library produced by the WinDAGs / MoltNet / Absurd planning
investigation. See
[`docs/research/windags-absurd-planning.md`](../../docs/research/windags-absurd-planning.md)
for the findings, evidence, and recommendation.

What is here:

| Path                           | Purpose                                                                                                                                                                                                        |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/plan/schema.ts`           | Versioned `WorkflowPlan` representation (TypeBox): task / human-gate / join nodes, explicit dependencies, input bindings, contracts, authority, recovery, termination, provenance, process model               |
| `src/plan/validate.ts`         | Structural validator: unique ids, resolvable references, cycles, implicit dependencies, gate options and edges, revision targets, termination                                                                  |
| `src/windags/convert.ts`       | Import a WinDAGs `PredictedDAG` (+ `DecomposerOutput`) into a `WorkflowPlan`, recording every loss in `provenance.lossNotes`                                                                                   |
| `src/executor/execute-plan.ts` | Thin executor over `@themoltnet/tasks-orchestrator`'s `WorkflowContext` + `TaskClient`: idempotent task creation, explicit output binding, human gates, bounded repair, invalidation, fail-closed plan pinning |
| `src/testing/*`                | Hand-authored reference plan and **fakes** (task service, decision store, domain check) used by the tests                                                                                                      |
| `fixtures/upstream/*`          | Recorded upstream behaviour at windags-skills `9e2fed3b` (static trace + two live runs)                                                                                                                        |
| `fixtures/harness/*`           | Scripts that produced the fixtures against a pinned upstream checkout (no upstream code is vendored; upstream is BUSL-1.1)                                                                                     |

Run:

```bash
pnpm exec nx run @moltnet/workflow-plan:test
pnpm exec nx run @moltnet/workflow-plan:typecheck
pnpm exec nx run @moltnet/workflow-plan:lint
# opt-in real Absurd durability (needs pnpm run e2e:up):
ORCHESTRATION_ABSURD_URL=postgresql://issue_lifecycle:issue_lifecycle_secret@localhost:55434/issue_lifecycle \
  pnpm exec nx run @moltnet/workflow-plan:test
```
