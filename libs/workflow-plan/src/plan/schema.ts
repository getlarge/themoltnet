/**
 * Versioned workflow-plan representation (research spike).
 *
 * A plan is DATA that an orchestrator validates and executes; it never carries
 * executable orchestration code. The representation separates:
 *
 * - the expert's process model (`process`): activities, decisions, and the
 *   rules behind them, kept for review and provenance; from
 * - the executable plan for one case (`nodes`): concrete tasks, gates, joins,
 *   and bindings that an orchestrator can drive to completion.
 *
 * Everything an executor needs to resume after an interruption is either in
 * the accepted plan revision or in durable checkpoints keyed by node id.
 */
import { type Static, Type } from 'typebox';

export const WORKFLOW_PLAN_SCHEMA_VERSION = 1 as const;

const NodeId = Type.String({ pattern: '^[a-z0-9][a-z0-9-]{0,63}$' });

/** How a node's input is bound: by reference to an upstream output or a literal. */
export const InputBinding = Type.Union(
  [
    Type.Object(
      {
        kind: Type.Literal('output'),
        /** Upstream node whose accepted output is consumed. */
        node: NodeId,
        /**
         * Optional JSON pointer into the upstream output. Absent = whole
         * output artifact.
         */
        pointer: Type.Optional(Type.String()),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        kind: Type.Literal('decision'),
        /** Human-gate node whose recorded decision is consumed. */
        node: NodeId,
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        kind: Type.Literal('literal'),
        value: Type.Unknown(),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        kind: Type.Literal('artifact'),
        /** Content-addressed input staged before execution. */
        cid: Type.String({ minLength: 1 }),
        contentType: Type.Optional(Type.String()),
      },
      { additionalProperties: false },
    ),
  ],
  { $id: 'InputBinding' },
);
export type InputBinding = Static<typeof InputBinding>;

/** Output contract: a JSON schema plus which domain checks apply. */
export const OutputContract = Type.Object(
  {
    /** JSON schema the accepted output must satisfy (structural acceptance). */
    schema: Type.Unknown(),
    /**
     * Named domain checks applied by the orchestrator after structural
     * validation (e.g. `citations-resolve`). Check implementations live in
     * trusted code; the plan only names them.
     */
    domainChecks: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  },
  { $id: 'PlanOutputContract', additionalProperties: false },
);
export type OutputContract = Static<typeof OutputContract>;

/** Who may execute a task node and under which authority. */
export const ExecutionAuthority = Type.Object(
  {
    /** MoltNet runtime-profile allowlist. Empty = unrestricted (MoltNet semantics). */
    allowedProfiles: Type.Array(
      Type.Object(
        { profileId: Type.String({ minLength: 1 }) },
        { additionalProperties: false },
      ),
      { maxItems: 16 },
    ),
    requiredExecutorTrustLevel: Type.Optional(
      Type.Union([
        Type.Literal('selfDeclared'),
        Type.Literal('agentSigned'),
        Type.Literal('releaseVerifiedTool'),
        Type.Literal('sandboxAttested'),
      ]),
    ),
    /** Skills the planner selected. Advisory until demonstrated by a profile. */
    selectedSkills: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
    /**
     * Capabilities the node demonstrably needs (tool policy, integrations).
     * Kept separate from `selectedSkills`: a skill name is not evidence that
     * the executor can do the work.
     */
    requiredCapabilities: Type.Optional(
      Type.Array(Type.String({ minLength: 1 })),
    ),
  },
  { $id: 'ExecutionAuthority', additionalProperties: false },
);
export type ExecutionAuthority = Static<typeof ExecutionAuthority>;

/** Retry (execution failure), repair (domain-invalid output), and replacement. */
export const RecoveryPolicy = Type.Object(
  {
    /** MoltNet task attempt budget (execution failures before acceptance). */
    maxAttempts: Type.Integer({ minimum: 1, maximum: 10 }),
    /** Bounded semantic-repair chain for accepted-but-invalid output. */
    maxRepairs: Type.Integer({ minimum: 0, maximum: 5 }),
    /** New task IDs for the same frozen request after terminal failure. */
    maxReplacements: Type.Optional(Type.Integer({ minimum: 0, maximum: 3 })),
    /** What the orchestrator does when every budget is spent. */
    onExhausted: Type.Union([
      Type.Literal('block'),
      Type.Literal('escalate_to_human'),
      Type.Literal('fail_workflow'),
    ]),
  },
  { $id: 'RecoveryPolicy', additionalProperties: false },
);
export type RecoveryPolicy = Static<typeof RecoveryPolicy>;

/** A unit of delegated work that becomes one MoltNet task. */
export const TaskNode = Type.Object(
  {
    id: NodeId,
    kind: Type.Literal('task'),
    title: Type.String({ minLength: 1, maxLength: 200 }),
    /** Explicit predecessor set. The executor never infers this from waves. */
    dependsOn: Type.Array(NodeId),
    /** MoltNet task type; `freeform` is the discovery lane. */
    taskType: Type.String({ minLength: 1 }),
    /** Brief for the executing agent. */
    brief: Type.String({ minLength: 1 }),
    inputs: Type.Record(
      Type.String({ pattern: '^[a-zA-Z][a-zA-Z0-9_]*$' }),
      InputBinding,
    ),
    output: OutputContract,
    authority: ExecutionAuthority,
    recovery: RecoveryPolicy,
    /** Planner confidence that the node is needed at all. */
    commitment: Type.Optional(
      Type.Union([
        Type.Literal('committed'),
        Type.Literal('tentative'),
        Type.Literal('exploratory'),
      ]),
    ),
    /** Planner-estimated minutes/cost. Informational only. */
    estimate: Type.Optional(
      Type.Object(
        {
          minutes: Type.Optional(Type.Number({ minimum: 0 })),
          costUsd: Type.Optional(Type.Number({ minimum: 0 })),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { $id: 'TaskNode', additionalProperties: false },
);
export type TaskNode = Static<typeof TaskNode>;

/** A human decision that gates downstream work. */
export const HumanGateNode = Type.Object(
  {
    id: NodeId,
    kind: Type.Literal('human_gate'),
    title: Type.String({ minLength: 1, maxLength: 200 }),
    dependsOn: Type.Array(NodeId),
    /** The exact upstream output revision the reviewer sees. */
    reviews: Type.Object({ node: NodeId }, { additionalProperties: false }),
    /** Allowed responses. Every downstream edge must be reachable from one. */
    options: Type.Array(
      Type.Union([
        Type.Literal('approve'),
        Type.Literal('request_revision'),
        Type.Literal('reject'),
      ]),
      { minItems: 1, maxItems: 3 },
    ),
    /** Who may decide. Names a role, not a model. */
    decider: Type.Object(
      {
        role: Type.String({ minLength: 1 }),
        /** Whether an attributed note is enough or authentication is required. */
        attestation: Type.Union([
          Type.Literal('attributed_note'),
          Type.Literal('authenticated'),
        ]),
      },
      { additionalProperties: false },
    ),
    /** On `request_revision`, which node is re-run (must be `reviews.node` or its ancestor). */
    revisionTarget: Type.Optional(NodeId),
    /** Bound revisions before the gate is treated as exhausted. */
    maxRevisions: Type.Integer({ minimum: 0, maximum: 5 }),
    /** Durable wait behavior. */
    wait: Type.Object(
      {
        pollIntervalSec: Type.Integer({ minimum: 1 }),
        timeoutSec: Type.Optional(Type.Integer({ minimum: 1 })),
        onTimeout: Type.Optional(
          Type.Union([Type.Literal('block'), Type.Literal('reject')]),
        ),
      },
      { additionalProperties: false },
    ),
  },
  { $id: 'HumanGateNode', additionalProperties: false },
);
export type HumanGateNode = Static<typeof HumanGateNode>;

/** A join: the executor's own synchronization point, no agent work. */
export const JoinNode = Type.Object(
  {
    id: NodeId,
    kind: Type.Literal('join'),
    title: Type.String({ minLength: 1, maxLength: 200 }),
    dependsOn: Type.Array(NodeId, { minItems: 2 }),
    mode: Type.Union([Type.Literal('all'), Type.Literal('any')]),
  },
  { $id: 'JoinNode', additionalProperties: false },
);
export type JoinNode = Static<typeof JoinNode>;

export const PlanNode = Type.Union([TaskNode, HumanGateNode, JoinNode], {
  $id: 'PlanNode',
});
export type PlanNode = Static<typeof PlanNode>;

/** A conditional edge: a successor that only becomes eligible on a decision. */
export const GateEdge = Type.Object(
  {
    from: NodeId,
    /** Decision option that enables `to`. */
    when: Type.Union([
      Type.Literal('approve'),
      Type.Literal('request_revision'),
      Type.Literal('reject'),
    ]),
    to: NodeId,
  },
  { $id: 'GateEdge', additionalProperties: false },
);
export type GateEdge = Static<typeof GateEdge>;

/** The expert's process model: kept for review, never executed directly. */
export const ProcessModel = Type.Object(
  {
    owner: Type.String({ minLength: 1 }),
    /** Activities and decisions as elicited, with sources. */
    activities: Type.Array(
      Type.Object(
        {
          id: Type.String({ minLength: 1 }),
          description: Type.String({ minLength: 1 }),
          executionOwner: Type.Union([
            Type.Literal('person'),
            Type.Literal('fixed_tool'),
            Type.Literal('bounded_model_call'),
            Type.Literal('agent'),
            Type.Literal('orchestrator'),
          ]),
          source: Type.Optional(Type.String()),
          /** `extracted` | `interpretation` | `assumption` | `proposal` | `decision` */
          status: Type.Union([
            Type.Literal('extracted'),
            Type.Literal('interpretation'),
            Type.Literal('assumption'),
            Type.Literal('proposal'),
            Type.Literal('decision'),
          ]),
        },
        { additionalProperties: false },
      ),
    ),
    unresolvedQuestions: Type.Optional(
      Type.Array(
        Type.Object(
          {
            id: Type.String({ minLength: 1 }),
            question: Type.String({ minLength: 1 }),
            answerer: Type.String({ minLength: 1 }),
            blocks: Type.Array(NodeId),
          },
          { additionalProperties: false },
        ),
      ),
    ),
  },
  { $id: 'ProcessModel', additionalProperties: false },
);
export type ProcessModel = Static<typeof ProcessModel>;

export const TerminationPolicy = Type.Object(
  {
    /** Nodes whose acceptance completes the workflow. */
    successNodes: Type.Array(NodeId, { minItems: 1 }),
    /** Upper bound on total MoltNet tasks (original + repairs + replacements). */
    maxTotalTasks: Type.Integer({ minimum: 1 }),
    /** Upper bound on plan extensions accepted during execution (option 2). */
    maxPlanRevisions: Type.Integer({ minimum: 0 }),
    /** Wall-clock budget for the whole execution; `block` after it. */
    deadlineSec: Type.Optional(Type.Integer({ minimum: 1 })),
    /** Who may cancel; the executor records it and marks in-flight tasks. */
    cancellableBy: Type.Array(Type.String({ minLength: 1 })),
  },
  { $id: 'TerminationPolicy', additionalProperties: false },
);
export type TerminationPolicy = Static<typeof TerminationPolicy>;

export const PlanProvenance = Type.Object(
  {
    /** `hand_authored` | `windags` | `agent_proposed` | ... */
    source: Type.String({ minLength: 1 }),
    /** Opaque reference to the raw planner output this plan was converted from. */
    sourceRef: Type.Optional(Type.String()),
    /** What the conversion could not recover (informs the reviewer). */
    lossNotes: Type.Optional(Type.Array(Type.String())),
    acceptedBy: Type.Optional(Type.String()),
    acceptedAt: Type.Optional(Type.String({ format: 'date-time' })),
  },
  { $id: 'PlanProvenance', additionalProperties: false },
);
export type PlanProvenance = Static<typeof PlanProvenance>;

export const WorkflowPlan = Type.Object(
  {
    schemaVersion: Type.Literal(WORKFLOW_PLAN_SCHEMA_VERSION),
    /** Stable plan identity across revisions. */
    planId: Type.String({ minLength: 1 }),
    /** Monotonic revision; a new revision never mutates an accepted one. */
    revision: Type.Integer({ minimum: 1 }),
    /** Revision this one extends (plan extension during execution). */
    extends: Type.Optional(Type.Integer({ minimum: 1 })),
    title: Type.String({ minLength: 1, maxLength: 200 }),
    /** MoltNet team/diary the tasks are created in. */
    scope: Type.Object(
      {
        teamId: Type.String({ minLength: 1 }),
        diaryId: Type.String({ minLength: 1 }),
        correlationId: Type.Optional(Type.String({ minLength: 1 })),
      },
      { additionalProperties: false },
    ),
    process: Type.Optional(ProcessModel),
    nodes: Type.Array(PlanNode, { minItems: 1, maxItems: 64 }),
    gateEdges: Type.Array(GateEdge),
    termination: TerminationPolicy,
    provenance: PlanProvenance,
  },
  { $id: 'WorkflowPlan', additionalProperties: false },
);
export type WorkflowPlan = Static<typeof WorkflowPlan>;
