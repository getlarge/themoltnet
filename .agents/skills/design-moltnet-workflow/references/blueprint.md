# A reviewable workflow blueprint

Use one design with linked views. Scale detail to the selected slice; a small
process need not fill a large template. Record unknowns rather than inventing
numbers or requirements to complete sections.

## Purpose and evidence

State the owner and recipient, desired improvement, current baseline, evidence
sources, automation recommendation, and pilot scope. Distinguish measured facts
from estimates and proposed behavior. Explain any recommendation to keep human
work or simplify the existing process.

## Process and decisions

Draw activities, parallel work, handoffs, decisions, waits, and exception paths.
Label execution owner: person, fixed tool, bounded model call, agent, or
orchestrator. Mark which edges are designed, implemented, and observed.

List material decisions separately: required inputs, applicable rules, who may
decide, output, and effect on progression. Use a decision table where rules are
explicit. [DMN](https://www.omg.org/intro/DMN.pdf) supplies this useful distinction;
adopting its entire notation or engine is optional.

## Stage and handoff contract

For each boundary that matters, specify:

| Field | Meaning |
|---|---|
| Purpose | Observable result and its recipient |
| Inputs | Source, revision, access, freshness, and permitted use |
| Output | Shape/artifact and semantic meaning; downstream consumer |
| Evidence | Citations, calculations, checks, unresolved uncertainty |
| Acceptance | Check, checker, failure treatment, and scope not checked |
| Authority | Tools, actions, human decisions, and permitted destinations |
| Context | Reusable guidance versus case-specific facts; excluded evaluation material |
| Execution | Tool/model/agent/human assignment, proposed task type and profile requirements |
| Bounds | Deadline, execution budget, attempts/repairs, escalation |
| Reuse | What changes invalidate the output; how lineage is preserved |

Use explicit statuses for extracted facts, interpretations, assumptions, proposals,
and decisions when downstream behavior depends on their authority. Resolve source
IDs against actual inputs; valid identifiers alone do not prove claim support.

## State and recovery

Define the distinct handling of:

- Execution failure: retry eligibility, idempotency, budget, final state.
- Domain-invalid output: exact feedback, bounded repair, escalation.
- Missing input or decision: persisted question, owner, blocked scope, resume event.
- Changed inputs: new revision and invalidation of affected results or approvals.
- Cancellation: who can cancel and what in-flight or external effects remain.

For a human gate, specify the reviewer-visible artifact revision, allowed
responses, recorded identity/provenance, storage, waiting/expiry behavior, and
resume mechanism. A workflow that merely displays a question has no completed
approval/resume integration. An authenticated approval and an attributed note
are different forms of evidence; choose what the application requires.

## First slice and decision after the pilot

List the representative cases, baseline, quality and effort measures, acceptable
failure/escalation behavior, and who decides whether to continue. Include the
next real consumer in the slice. A passing parser without a usable handoff is
insufficient evidence.

Finish with the most consequential unresolved decisions and a concrete next
experiment. Avoid turning every unknown into an immediate user question.
