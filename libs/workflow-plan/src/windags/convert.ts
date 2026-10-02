/**
 * Import a WinDAGs `/next-move` result into a {@link WorkflowPlan}.
 *
 * The conversion is deliberately lossy-but-honest: whatever the upstream
 * output does not carry is recorded in `provenance.lossNotes` instead of being
 * invented. In particular, the validated `PredictedDAG` returned by upstream
 * (windags-skills @ 9e2fed3b) has every `dependencies` array empty and no
 * input/output contracts, so a usable plan needs the `DecomposerOutput` stage
 * as well. Pass both when you have them.
 */
import type {
  GateEdge,
  HumanGateNode,
  PlanNode,
  TaskNode,
  WorkflowPlan,
} from '../plan/schema.js';

/** Minimal upstream shapes we read; everything else is ignored. */
export interface WinDagsPredictedNode {
  id: string;
  skill_id: string;
  role_description: string;
  dependencies?: string[];
  model_tier?: string;
  estimated_minutes?: number;
  estimated_cost_usd?: number;
  input_contract?: string;
  output_contract?: string;
  commitment_level?: string;
}

export interface WinDagsPredictedDag {
  title: string;
  waves: Array<{ wave_number?: number; nodes: WinDagsPredictedNode[] }>;
  topology?: string | null;
  premortem?: { recommendation?: string; risks?: unknown[] };
}

export interface WinDagsDecomposerOutput {
  subtasks: Array<{
    id: string;
    description: string;
    depends_on?: string[];
    testable_outcome?: string;
  }>;
}

export interface ConvertOptions {
  planId: string;
  scope: WorkflowPlan['scope'];
  /** Node ids (or skill ids) that denote a human gate. */
  gateSkillIds?: string[];
  /** Node ids the converter drops because they are policies, not work. */
  policyNodeIds?: string[];
  sourceRef?: string;
}

const DEFAULT_GATE_SKILLS = ['human-gate-designer'];

function isGate(node: WinDagsPredictedNode, gateSkills: string[]): boolean {
  return (
    gateSkills.includes(node.skill_id) ||
    /(^|-)(gate|approval|decision)(-|$)/.test(node.id)
  );
}

function commitment(level: string | undefined): TaskNode['commitment'] {
  switch ((level ?? '').toUpperCase()) {
    case 'COMMITTED':
      return 'committed';
    case 'TENTATIVE':
      return 'tentative';
    case 'EXPLORATORY':
      return 'exploratory';
    default:
      return undefined;
  }
}

export interface ConvertResult {
  plan: WorkflowPlan;
  lossNotes: string[];
}

export function convertWinDagsPrediction(
  dag: WinDagsPredictedDag,
  decomposer: WinDagsDecomposerOutput | undefined,
  options: ConvertOptions,
): ConvertResult {
  const lossNotes: string[] = [];
  const gateSkills = options.gateSkillIds ?? DEFAULT_GATE_SKILLS;
  const policyIds = new Set(options.policyNodeIds ?? []);
  const subtaskById = new Map(
    (decomposer?.subtasks ?? []).map((s) => [s.id, s] as const),
  );

  const upstreamNodes = dag.waves.flatMap((w) => w.nodes);
  const knownIds = new Set(upstreamNodes.map((n) => n.id));

  const dependenciesFor = (node: WinDagsPredictedNode): string[] => {
    const fromDag = node.dependencies ?? [];
    if (fromDag.length > 0) return fromDag;
    const fromDecomposer = subtaskById.get(node.id)?.depends_on ?? [];
    return fromDecomposer;
  };

  const anyDagDeps = upstreamNodes.some(
    (n) => (n.dependencies ?? []).length > 0,
  );
  if (!anyDagDeps && upstreamNodes.length > 1) {
    lossNotes.push(
      decomposer
        ? 'PredictedDAG carried no node dependencies; dependencies were recovered from the DecomposerOutput stage.'
        : 'PredictedDAG carried no node dependencies and no DecomposerOutput was supplied; wave order is NOT a dependency graph, so nodes are left independent.',
    );
  }
  if (upstreamNodes.every((n) => !n.input_contract && !n.output_contract)) {
    lossNotes.push(
      'No input/output contracts survived upstream validation; task output contracts are set to an open schema and must be authored by a reviewer.',
    );
  }

  const nodes: PlanNode[] = [];
  const gateEdges: GateEdge[] = [];
  const gates: HumanGateNode[] = [];

  for (const upstream of upstreamNodes) {
    if (policyIds.has(upstream.id)) {
      lossNotes.push(
        `Upstream node '${upstream.id}' was dropped: it describes a recovery policy, which the plan expresses as RecoveryPolicy on the repaired node instead of as work.`,
      );
      continue;
    }
    const deps = dependenciesFor(upstream).filter((d) => {
      const known = knownIds.has(d) && !policyIds.has(d);
      if (!known) {
        lossNotes.push(
          `Upstream node '${upstream.id}' depended on unknown or dropped node '${d}'.`,
        );
      }
      return known;
    });
    if (isGate(upstream, gateSkills)) {
      const reviewed = deps[0];
      if (!reviewed) {
        lossNotes.push(
          `Upstream gate '${upstream.id}' has no upstream node to review; it cannot be converted and was dropped.`,
        );
        continue;
      }
      const gate: HumanGateNode = {
        id: upstream.id,
        kind: 'human_gate',
        title: upstream.role_description.slice(0, 200) || upstream.id,
        dependsOn: deps,
        reviews: { node: reviewed },
        options: ['approve', 'request_revision', 'reject'],
        decider: { role: 'process-owner', attestation: 'attributed_note' },
        maxRevisions: 1,
        wait: { pollIntervalSec: 5 },
      };
      gates.push(gate);
      nodes.push(gate);
      lossNotes.push(
        `Gate '${upstream.id}': upstream names a skill ('${upstream.skill_id}') but no decider, options, or revision policy; defaults were applied and need review.`,
      );
      continue;
    }
    const subtask = subtaskById.get(upstream.id);
    const inputs: TaskNode['inputs'] = {};
    for (const dep of deps) {
      const key = dep.replace(/[^a-zA-Z0-9_]/g, '_');
      inputs[key] = { kind: 'output', node: dep };
    }
    const task: TaskNode = {
      id: upstream.id,
      kind: 'task',
      title:
        (subtask?.description ?? upstream.role_description).slice(0, 200) ||
        upstream.id,
      dependsOn: deps,
      taskType: 'freeform',
      brief: [
        upstream.role_description,
        subtask?.testable_outcome
          ? `Testable outcome: ${subtask.testable_outcome}`
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
      inputs,
      output: { schema: {} },
      authority: {
        allowedProfiles: [],
        selectedSkills: [upstream.skill_id],
      },
      recovery: { maxAttempts: 1, maxRepairs: 0, onExhausted: 'block' },
      commitment: commitment(upstream.commitment_level),
      estimate: {
        minutes: upstream.estimated_minutes,
        costUsd: upstream.estimated_cost_usd,
      },
    };
    nodes.push(task);
  }

  // Gate successors: upstream has no notion of "only on approve". Every
  // downstream of a gate is treated as approve-only and recorded as a loss.
  for (const gate of gates) {
    for (const node of nodes) {
      if (node.id !== gate.id && node.dependsOn.includes(gate.id)) {
        gateEdges.push({ from: gate.id, when: 'approve', to: node.id });
        if (node.kind === 'task') {
          node.inputs['decision'] = { kind: 'decision', node: gate.id };
        }
      }
    }
    lossNotes.push(
      `Gate '${gate.id}': upstream cannot express which decision enables a successor; all successors were wired to 'approve'.`,
    );
  }

  const successNodes = nodes
    .filter((n) => !nodes.some((m) => m.dependsOn.includes(n.id)))
    .map((n) => n.id);

  const plan: WorkflowPlan = {
    schemaVersion: 1,
    planId: options.planId,
    revision: 1,
    title: dag.title.slice(0, 200),
    scope: options.scope,
    nodes,
    gateEdges,
    termination: {
      successNodes:
        successNodes.length > 0 ? successNodes : [nodes[0]?.id ?? 'none'],
      maxTotalTasks: nodes.filter((n) => n.kind === 'task').length * 2,
      maxPlanRevisions: 0,
      cancellableBy: ['process-owner'],
    },
    provenance: {
      source: 'windags',
      sourceRef: options.sourceRef,
      lossNotes,
    },
  };
  return { plan, lossNotes };
}
