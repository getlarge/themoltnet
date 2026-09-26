# Choose boundaries and patterns

Start with the simplest plausible design, including ordinary code or one bounded
model call. A workflow can combine several patterns. Keep the user’s selected
platform unless a concrete requirement motivates a change.

## Choose task boundaries

A separate task is useful when it needs independent assignment, evidence access,
permissions, output acceptance, retry, inspection, or reuse. Several tool calls
can belong inside one task. Splitting a coupled judgment may discard context;
combining unrelated judgments may increase omissions and make repairs expensive.

Choose how a stage executes separately from how its output is accepted:

| Execution | Possible acceptance |
|---|---|
| API retrieval or calculation | Identifier/freshness checks, units, reconciliation |
| OCR or bounded model extraction | Schema, source coverage, citations, targeted visual review |
| Agent interpretation or investigation | Evidence-backed claims, domain checks, unresolved alternatives |
| Human decision | Authority, chosen option, exact revision, rationale and provenance |

Uncertain output alone does not require an autonomous agent. Check whether the
work actually needs adaptive tool use or a bounded transformation is sufficient.

## Pattern selection

Adapted from [Anthropic, Building effective agents](https://www.anthropic.com/engineering/building-effective-agents).
The execution recommendations are our MoltNet adaptations.

| Pattern | Fit | Design requirement | Reason to simplify or change it |
|---|---|---|---|
| Chaining | Known stages with distinct handoffs | Validate and explicitly pass the accepted artifact to the next stage | Intermediate boundaries add latency without improving quality or recovery |
| Routing | Distinguishable case types need different handling | Prefer explicit rules when adequate; validate model route choices and handle unknowns | Misrouting dominates failures, or one path works equally well |
| Parallel sectioning | Independent work can proceed concurrently | Define evidence partitions, join/merge contract, shared-resource limits, partial-failure behavior | Work is tightly coupled or merge effort erases the benefit |
| Parallel voting | Multiple assessments may improve a judgment | Define aggregation, tie/escalation rules; measure correlated error | Agreement adds little accuracy or shares the same unsupported premise |
| Orchestrator-workers | Subtasks depend on what is discovered in the case | Validate a proposed plan against allowed types, profiles, dependencies, total budget and stopping conditions | Plans are usually predictable or coordination dominates useful work |
| Evaluator-optimizer | Actionable feedback improves a candidate | Stable criteria, bounded repairs, exact findings, progress/stop checks | Checker errors or repeated rediscovery produce churn |
| Autonomous loop | The next action depends on environmental feedback | Bounded tools/authority, evidence of progress, time budget and escalation | A fixed path or model call achieves the same outcome |

Distinguish executing work, selecting a declared route, and changing the workflow.
Giving an agent one permission does not imply the others. A dynamic planner can
propose work while deterministic orchestration validates and executes the plan.

For every selected pattern, record its purpose, prerequisites, simpler
alternative, and the pilot observation that will justify keeping it.

## Document-processing failures

When a broad extraction or review performs poorly, compare alternative
decompositions as well as prompts/models: targeted fields, page/region work,
neighboring context, document-wide reconciliation, or human review of difficult
regions. Splitting can lose relationships; aggregation needs its own checks.

[DocETL](https://arxiv.org/html/2410.12189v3) provides concrete pipeline-rewrite
examples. Its improvements on selected tasks do not establish expected gains
for this process. Use held-out domain examples to compare candidate designs.

## Choosing an orchestration platform

Decide from integration availability, who maintains the flow, data transformations,
durable waits, human interactions, branching, recovery, versioning, and testing.

- Consider n8n when its integrations and visual authoring fit the maintainers.
  Check how waits, failed executions, and duplicate callbacks behave in the
  deployed configuration.
- Consider Node-RED when message flows fit the environment. Persist identifiers
  and state needed for recovery and establish how interrupted flows resume.
- Consider custom durable code when domain validation, revision handling,
  programmatic composition, and recovery tests justify owning that code.

Visual authoring and durable execution are separate properties. MoltNet tasks
can survive while the caller's flow loses its place. Name the component that
owns overall progress and how it reconciles existing tasks after a restart.

See [MoltNet integrations](https://github.com/getlarge/themoltnet/blob/main/docs/use/sdk-and-integrations.md),
[n8n Wait](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.wait/),
and [Node-RED context storage](https://nodered.org/docs/user-guide/context).
