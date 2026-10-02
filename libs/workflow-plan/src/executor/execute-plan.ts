/**
 * Thin plan executor over the tasks-orchestrator `WorkflowContext`.
 *
 * Responsibilities (and only these):
 * - pin the accepted plan revision in the first checkpoint and fail closed if
 *   a recovered execution is handed a different plan;
 * - create one MoltNet task per eligible task node behind a replay-safe
 *   `createTaskStep` (stable idempotency key per node run);
 * - bind inputs explicitly from accepted output revisions of predecessors;
 * - gate on persisted human decisions matched to the exact reviewed revision;
 * - repair accepted-but-invalid outputs through `waitForValidatedTask`;
 * - invalidate downstream work on a revision and block it on rejection.
 *
 * It does NOT own the task lifecycle (MoltNet does), does not decide for the
 * human (the DecisionStore does), and does not run any planner code.
 */
import { createHash } from 'node:crypto';

import {
  beginWorkflowStep,
  completeWorkflowStep,
  type CreateRepairTaskArgs,
  createTaskStep,
  type TaskClient,
  type TaskCreateStepMetadata,
  waitForValidatedTask,
  type WorkflowContext,
} from '@themoltnet/tasks-orchestrator';
import type { TSchema } from 'typebox';
import { Value } from 'typebox/value';

import type {
  HumanGateNode,
  InputBinding,
  PlanNode,
  TaskNode,
  WorkflowPlan,
} from '../plan/schema.js';
import { validateWorkflowPlan } from '../plan/validate.js';
import type {
  DecisionRecord,
  ExecutionResult,
  NodeState,
  OutputRevision,
  PlanExecutorDeps,
  SdkTask,
} from './types.js';

export class PlanMismatchError extends Error {
  constructor(
    readonly expected: string,
    readonly actual: string,
  ) {
    super(
      `recovered execution was handed a different plan (accepted ${expected}, got ${actual}); refusing to continue`,
    );
    this.name = 'PlanMismatchError';
  }
}

export function planFingerprint(plan: WorkflowPlan): string {
  return createHash('sha256')
    .update(JSON.stringify(plan))
    .digest('base64url')
    .slice(0, 32);
}

function defaultValidateOutput(schema: unknown, output: unknown): string[] {
  if (
    !schema ||
    typeof schema !== 'object' ||
    Object.keys(schema).length === 0
  ) {
    return [];
  }
  // TypeBox validates JSON-Schema-shaped objects directly.
  const s = schema as TSchema;
  if (Value.Check(s, output)) return [];
  return [...Value.Errors(s, output)].map(
    (e) => `${e.instancePath || '/'}: ${e.message}`,
  );
}

function stepKey(node: string, runN: number, suffix: string): string {
  return `node.${node}.r${runN}.${suffix}`;
}

interface BoundInput {
  name: string;
  binding: InputBinding;
  revision?: OutputRevision;
  value?: unknown;
}

export async function executePlan(
  plan: WorkflowPlan,
  ctx: WorkflowContext,
  deps: PlanExecutorDeps,
): Promise<ExecutionResult> {
  const validation = validateWorkflowPlan(plan);
  if (!validation.ok) {
    throw new Error(
      `plan ${plan.planId} r${plan.revision} is not executable: ${validation.issues
        .map((i) => i.message)
        .join('; ')}`,
    );
  }
  const fingerprint = planFingerprint(plan);
  const accepted = await ctx.step('plan.accepted', () =>
    Promise.resolve({
      planId: plan.planId,
      revision: plan.revision,
      fingerprint,
    }),
  );
  if (accepted.fingerprint !== fingerprint) {
    throw new PlanMismatchError(accepted.fingerprint, fingerprint);
  }

  const validateOutput = deps.validateOutput ?? defaultValidateOutput;
  const now = deps.now ?? (() => new Date().toISOString());
  const pollIntervalSec = deps.pollIntervalSec ?? 5;
  const byId = new Map<string, PlanNode>(plan.nodes.map((n) => [n.id, n]));
  const order = validation.order;
  const states: Record<string, NodeState> = {};
  for (const node of plan.nodes) {
    states[node.id] = {
      node: node.id,
      status: 'pending',
      runN: 0,
      taskIds: [],
    };
  }
  const decisions: DecisionRecord[] = [];
  let tasksCreated = 0;

  const descendantsOf = (id: string): string[] => {
    const out = new Set<string>();
    const stack = [id];
    while (stack.length > 0) {
      const cur = stack.pop() as string;
      for (const n of plan.nodes) {
        if (n.dependsOn.includes(cur) && !out.has(n.id)) {
          out.add(n.id);
          stack.push(n.id);
        }
      }
    }
    return [...out];
  };

  const invalidateDescendants = (id: string, reason: string) => {
    for (const d of descendantsOf(id)) {
      const s = states[d];
      if (
        s.status === 'accepted' ||
        s.status === 'decided' ||
        s.status === 'awaiting_decision'
      ) {
        s.status = 'invalidated';
        s.reason = reason;
        s.accepted = undefined;
        s.decision = undefined;
      }
    }
  };

  const blockDescendants = (
    id: string,
    status: 'skipped_by_decision' | 'blocked',
    reason: string,
  ) => {
    for (const d of descendantsOf(id)) {
      states[d].status = status;
      states[d].reason = reason;
    }
  };

  const terminal = (
    status: ExecutionResult['status'],
    reason?: string,
  ): ExecutionResult => ({
    planId: plan.planId,
    planRevision: plan.revision,
    status,
    nodes: states,
    tasksCreated,
    decisions,
    reason,
  });

  const resolveInputs = (node: TaskNode): BoundInput[] | null => {
    const bound: BoundInput[] = [];
    for (const [name, binding] of Object.entries(node.inputs)) {
      if (binding.kind === 'output') {
        const src = states[binding.node];
        if (!src.accepted) return null;
        bound.push({
          name,
          binding,
          revision: src.accepted,
          value: src.accepted.output,
        });
      } else if (binding.kind === 'decision') {
        const src = states[binding.node];
        if (!src.decision) return null;
        bound.push({ name, binding, value: src.decision });
      } else if (binding.kind === 'literal') {
        bound.push({ name, binding, value: binding.value });
      } else {
        bound.push({ name, binding });
      }
    }
    return bound;
  };

  type CreatedRun = { node: TaskNode; runN: number; task: SdkTask };

  const createTaskFor = async (node: TaskNode): Promise<CreatedRun | null> => {
    const state = states[node.id];
    state.runN += 1;
    const runN = state.runN;
    const inputs = resolveInputs(node);
    if (!inputs) {
      state.status = 'blocked';
      state.reason = 'unresolved input binding';
      return null;
    }
    if (tasksCreated >= plan.termination.maxTotalTasks) {
      state.status = 'blocked';
      state.reason = 'termination.maxTotalTasks reached';
      return null;
    }
    const briefLines = [node.brief, '', 'Bound inputs:'];
    const references: Array<Record<string, unknown>> = [];
    for (const input of inputs) {
      if (input.binding.kind === 'output' && input.revision) {
        briefLines.push(
          `- ${input.name}: output of task ${input.revision.taskId} attempt ${input.revision.attemptN} (cid ${input.revision.outputCid ?? 'n/a'})`,
        );
        references.push({
          taskId: input.revision.taskId,
          outputCid: input.revision.outputCid ?? undefined,
          role: 'context',
        });
      } else if (input.binding.kind === 'decision') {
        const d = input.value as DecisionRecord;
        briefLines.push(
          `- ${input.name}: decision '${d.option}' by ${d.decidedBy} on ${d.reviewed.node} run ${d.reviewed.runN} (task ${d.reviewed.taskId} attempt ${d.reviewed.attemptN})`,
        );
      } else if (input.binding.kind === 'artifact') {
        briefLines.push(`- ${input.name}: artifact ${input.binding.cid}`);
        references.push({
          taskId: null,
          role: 'context',
          artifact: { cid: input.binding.cid },
        });
      } else {
        briefLines.push(`- ${input.name}: ${JSON.stringify(input.value)}`);
      }
    }
    const body = {
      taskType: node.taskType,
      teamId: plan.scope.teamId,
      diaryId: plan.scope.diaryId,
      correlationId: plan.scope.correlationId,
      title: node.title,
      input: {
        brief: briefLines.join('\n'),
        outputContract: { version: 1 as const, schema: node.output.schema },
        context: {
          planId: plan.planId,
          planRevision: plan.revision,
          node: node.id,
          runN,
          boundInputs: inputs.map((i) => ({
            name: i.name,
            kind: i.binding.kind,
            revision: i.revision ?? null,
          })),
        },
      },
      references,
      allowedProfiles: node.authority.allowedProfiles,
      requiredExecutorTrustLevel: node.authority.requiredExecutorTrustLevel,
      maxAttempts: node.recovery.maxAttempts,
    };
    const createBody = body as unknown as Parameters<
      TaskClient['createTask']
    >[0];
    const task = await createTaskStep<SdkTask>(
      ctx,
      stepKey(node.id, runN, 'create'),
      ({ idempotencyKey }: TaskCreateStepMetadata) =>
        deps.tasks.createTask(createBody, { idempotencyKey }),
    );
    tasksCreated += 1;
    state.taskId = task.id;
    state.taskIds.push(task.id);
    state.status = 'task_created';
    await deps.hooks?.afterTaskCreate?.({ node: node.id, taskId: task.id });
    return { node, runN, task };
  };

  const awaitTaskFor = async ({
    node,
    runN,
    task,
  }: CreatedRun): Promise<'accepted' | 'failed' | 'exhausted'> => {
    const state = states[node.id];
    const parse = (output: unknown) => {
      const problems = validateOutput(node.output.schema, output);
      for (const name of node.output.domainChecks ?? []) {
        const check = deps.domainChecks?.[name];
        if (!check) {
          problems.push(
            `domain check '${name}' is not available to the orchestrator`,
          );
          continue;
        }
        problems.push(...check(output, { node: node.id, plan }));
      }
      if (problems.length > 0) throw new Error(problems.join('; '));
      return output;
    };

    const outcome = await waitForValidatedTask(task, {
      tasks: deps.tasks,
      ctx,
      pollIntervalSec,
      parse,
      maxRepairs: node.recovery.maxRepairs,
      logger: deps.logger,
      description: `${plan.planId}:${node.id}:r${runN}`,
      createRepairTask: ({
        task: prev,
        attempt,
        reason,
        repairN,
        idempotencyKey,
      }: CreateRepairTaskArgs) => {
        tasksCreated += 1;
        const repairBody = {
          taskType: 'freeform',
          teamId: plan.scope.teamId,
          diaryId: plan.scope.diaryId,
          correlationId: plan.scope.correlationId,
          title: `Repair: ${node.title} (${repairN}/${node.recovery.maxRepairs})`,
          input: {
            brief: `Repair the prior output so it satisfies the output contract.\nValidation feedback: ${reason}`,
            constraints: [`Resolve exactly this validation error: ${reason}`],
            outputContract: { version: 1 as const, schema: node.output.schema },
            continueFrom: {
              taskId: prev.id,
              attemptN: attempt.attemptN,
              mode: 'extend',
            },
            context: {
              planId: plan.planId,
              planRevision: plan.revision,
              node: node.id,
              runN,
              repairN,
            },
          },
          allowedProfiles: node.authority.allowedProfiles,
          maxAttempts: 1,
        } as unknown as Parameters<TaskClient['createTask']>[0];
        return deps.tasks.createTask(repairBody, { idempotencyKey });
      },
    });
    for (const link of outcome.chain) {
      const t =
        link.outcome.kind === 'accepted'
          ? link.outcome.result.task
          : link.outcome.task;
      if (!state.taskIds.includes(t.id)) state.taskIds.push(t.id);
    }
    if (outcome.kind === 'accepted') {
      state.status = 'accepted';
      state.accepted = {
        node: node.id,
        runN,
        taskId: outcome.result.task.id,
        attemptN: outcome.result.attempt.attemptN,
        outputCid: outcome.result.attempt.outputCid ?? null,
        output: outcome.result.state,
      };
      return 'accepted';
    }
    if (outcome.kind === 'exhausted') {
      state.status = 'invalid_output';
      state.reason = `repair budget exhausted: ${outcome.reason}`;
      return 'exhausted';
    }
    state.status = 'failed';
    state.reason = outcome.reason;
    return 'failed';
  };

  const waitForDecision = async (
    gate: HumanGateNode,
  ): Promise<DecisionRecord> => {
    const reviewed = states[gate.reviews.node].accepted;
    if (!reviewed) throw new Error(`gate ${gate.id} has nothing to review`);
    const revision: OutputRevision = {
      node: reviewed.node,
      runN: reviewed.runN,
      taskId: reviewed.taskId,
      attemptN: reviewed.attemptN,
      outputCid: reviewed.outputCid,
    };
    const handle = await beginWorkflowStep<DecisionRecord>(
      ctx,
      stepKey(
        gate.id,
        revision.runN,
        `decision.${revision.taskId}.${revision.attemptN}`,
      ),
    );
    if (handle.done) return handle.state;
    states[gate.id].status = 'awaiting_decision';
    for (let poll = 0; ; poll += 1) {
      await deps.hooks?.beforeGatePoll?.({ gate: gate.id });
      const found = await deps.decisions.find({
        planId: plan.planId,
        gate: gate.id,
        reviewed: revision,
      });
      if (found && gate.options.includes(found.option)) {
        return completeWorkflowStep(ctx, handle, found);
      }
      if (
        gate.wait.timeoutSec !== undefined &&
        poll * gate.wait.pollIntervalSec >= gate.wait.timeoutSec
      ) {
        const timeout: DecisionRecord = {
          planId: plan.planId,
          planRevision: plan.revision,
          gate: gate.id,
          reviewed: revision,
          option:
            gate.wait.onTimeout === 'reject' ? 'reject' : 'request_revision',
          note: 'gate timed out',
          decidedBy: 'orchestrator:timeout',
          decidedAt: now(),
        };
        if (gate.wait.onTimeout !== 'reject') {
          // "block" means stay visible and wait; there is no automatic decision.
          states[gate.id].status = 'blocked';
          states[gate.id].reason = 'gate timed out';
          throw new GateBlocked(gate.id);
        }
        return completeWorkflowStep(ctx, handle, timeout);
      }
      await ctx.sleepFor(
        stepKey(gate.id, revision.runN, `poll.${poll}`),
        gate.wait.pollIntervalSec,
      );
    }
  };

  // Main loop: process nodes in topological order; a revision re-enters the
  // loop from the revision target. Bounded by maxRevisions per gate and
  // maxTotalTasks overall.
  const revisionsUsed: Record<string, number> = {};
  let cursor = 0;
  while (cursor < order.length) {
    const id = order[cursor];
    const node = byId.get(id) as PlanNode;
    const state = states[id];
    if (state.status === 'skipped_by_decision' || state.status === 'blocked') {
      cursor += 1;
      continue;
    }
    if (state.status === 'accepted' || state.status === 'decided') {
      cursor += 1;
      continue;
    }
    const unmet = node.dependsOn.filter((d) => {
      const s = states[d];
      return !(s.status === 'accepted' || s.status === 'decided');
    });
    if (unmet.length > 0) {
      const blockedBy = unmet.find((d) =>
        ['skipped_by_decision', 'blocked', 'failed', 'invalid_output'].includes(
          states[d].status,
        ),
      );
      if (blockedBy) {
        state.status = 'blocked';
        state.reason = `dependency '${blockedBy}' is ${states[blockedBy].status}`;
        cursor += 1;
        continue;
      }
      state.status = 'waiting_dependencies';
      cursor += 1;
      continue;
    }
    if (node.kind === 'join') {
      state.status = 'accepted';
      cursor += 1;
      continue;
    }
    if (node.kind === 'task') {
      // Gather every task node that is ready right now so independent work is
      // created first and awaited together. Checkpoint names stay unique per
      // node run, so this is replay-safe (same discipline as parallelTasks).
      const batch: TaskNode[] = [];
      for (let i = cursor; i < order.length; i += 1) {
        const candidate = byId.get(order[i]) as PlanNode;
        if (candidate.kind !== 'task') continue;
        const cs = states[candidate.id];
        if (
          cs.status === 'accepted' ||
          cs.status === 'blocked' ||
          cs.status === 'skipped_by_decision'
        )
          continue;
        const ready = candidate.dependsOn.every((d) =>
          ['accepted', 'decided'].includes(states[d].status),
        );
        if (!ready) continue;
        const gateDeps = candidate.dependsOn.filter(
          (d) => byId.get(d)?.kind === 'human_gate',
        );
        const enabled = gateDeps.every((g) =>
          plan.gateEdges.some(
            (e) =>
              e.from === g &&
              e.to === candidate.id &&
              e.when === states[g].decision?.option,
          ),
        );
        if (!enabled) {
          cs.status = 'skipped_by_decision';
          cs.reason = 'gate decision did not enable this node';
          continue;
        }
        batch.push(candidate);
      }
      const created: CreatedRun[] = [];
      for (const ready of batch) {
        const run = await createTaskFor(ready);
        if (run) created.push(run);
      }
      const results = await Promise.all(
        created.map((run) => awaitTaskFor(run)),
      );
      for (let i = 0; i < created.length; i += 1) {
        const run = created[i];
        if (results[i] !== 'accepted') {
          const policy = run.node.recovery.onExhausted;
          const rs = states[run.node.id];
          blockDescendants(
            run.node.id,
            'blocked',
            `dependency '${run.node.id}' ${rs.status}`,
          );
          if (policy === 'fail_workflow')
            return terminal('failed', `${run.node.id}: ${rs.reason}`);
          return terminal(
            'blocked',
            `${run.node.id}: ${rs.reason} (policy: ${policy})`,
          );
        }
      }
      if (created.length < batch.length) {
        const missing = batch.find(
          (b) => !created.some((c) => c.node.id === b.id),
        ) as TaskNode;
        return terminal(
          'blocked',
          `${missing.id}: ${states[missing.id].reason}`,
        );
      }
      cursor += 1;
      continue;
    }
    // human gate
    let decision: DecisionRecord;
    try {
      decision = await waitForDecision(node);
    } catch (error) {
      if (error instanceof GateBlocked)
        return terminal(
          'blocked',
          `${node.id}: gate timed out without a decision`,
        );
      throw error;
    }
    decisions.push(decision);
    state.decision = decision;
    if (decision.option === 'approve') {
      state.status = 'decided';
      cursor += 1;
      continue;
    }
    if (decision.option === 'reject') {
      state.status = 'decided';
      blockDescendants(
        node.id,
        'skipped_by_decision',
        `gate '${node.id}' rejected`,
      );
      return terminal(
        'rejected',
        `${node.id}: rejected by ${decision.decidedBy}`,
      );
    }
    // request_revision
    const used = (revisionsUsed[node.id] ?? 0) + 1;
    revisionsUsed[node.id] = used;
    if (used > node.maxRevisions) {
      state.status = 'blocked';
      state.reason = `maxRevisions (${node.maxRevisions}) exceeded`;
      blockDescendants(
        node.id,
        'blocked',
        `gate '${node.id}' exhausted revisions`,
      );
      return terminal('blocked', `${node.id}: revision budget exhausted`);
    }
    const target = node.revisionTarget ?? node.reviews.node;
    states[target].status = 'invalidated';
    states[target].reason =
      `revision requested by ${decision.decidedBy}: ${decision.note ?? ''}`.trim();
    states[target].accepted = undefined;
    invalidateDescendants(target, `upstream '${target}' revised`);
    state.status = 'pending';
    state.decision = undefined;
    cursor = order.indexOf(target);
  }

  const success = plan.termination.successNodes.every(
    (id) => states[id].status === 'accepted',
  );
  return terminal(
    success ? 'completed' : 'blocked',
    success ? undefined : 'success nodes did not all complete',
  );
}

class GateBlocked extends Error {
  constructor(readonly gate: string) {
    super(`gate ${gate} blocked`);
  }
}
