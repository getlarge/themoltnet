import type { Agent } from '@themoltnet/sdk';
import {
  beginWorkflowStep,
  completeWorkflowStep,
  createTaskStep,
  type WorkflowContext,
} from '@themoltnet/tasks-orchestrator';

import { assessmentRequest, type PreparedBrief } from './brief.js';
import {
  type AcceptedWork,
  type EvidenceResult,
  type Handoff,
  type Revision,
  sameRevision,
} from './contracts.js';
import { cancelMoltNetTask, reconcileMoltNetTask } from './moltnet-repair.js';

type Criteria = NonNullable<
  Parameters<Agent['tasks']['buildAssessBrief']>[0]['successCriteria']['rubric']
>['criteria'];

/** Every approved criterion must pass; a weighted average cannot conceal a failed requirement. */
export function evaluateAssessment(
  criteria: Criteria,
  output: Record<string, unknown>,
  revision: Revision,
): EvidenceResult {
  const incomplete = { revision, status: 'incomplete' } as const;
  if (
    !criteria.length ||
    new Set(criteria.map((item) => item.id)).size !== criteria.length ||
    !Array.isArray(output.scores) ||
    output.scores.length !== criteria.length ||
    typeof output.composite !== 'number' ||
    !Number.isFinite(output.composite)
  )
    return incomplete;
  const scores = new Map<string, number>();
  for (const item of output.scores as unknown[]) {
    if (
      !item ||
      typeof item !== 'object' ||
      !('criterionId' in item) ||
      typeof item.criterionId !== 'string' ||
      !('score' in item) ||
      typeof item.score !== 'number' ||
      !Number.isFinite(item.score) ||
      item.score < 0 ||
      item.score > 1 ||
      scores.has(item.criterionId)
    )
      return incomplete;
    const criterion = criteria.find((value) => value.id === item.criterionId);
    if (
      !criterion ||
      (criterion.scoring !== 'llm_score' &&
        item.score !== 0 &&
        item.score !== 1) ||
      (criterion.scoring === 'llm_score' &&
        (!('rationale' in item) ||
          typeof item.rationale !== 'string' ||
          !item.rationale.trim()))
    )
      return incomplete;
    scores.set(item.criterionId, item.score);
  }
  const composite = criteria.reduce(
    (sum, item) => sum + item.weight * (scores.get(item.id) ?? 0),
    0,
  );
  if (Math.abs(composite - output.composite) > 1e-6) return incomplete;
  return {
    revision,
    status: criteria.every((item) => scores.get(item.id) === 1)
      ? 'passed'
      : 'failed',
  };
}

export interface AssessmentInput {
  brief: PreparedBrief;
  delivery: Handoff;
  timeoutSec: number;
  pollIntervalSec: number;
}
export interface AssessmentResult {
  evidence: EvidenceResult;
  acceptedWork?: AcceptedWork;
  reason?: string;
}

/** Independently runnable assessment, pinned to accepted delivery and its approved rubric. */
export async function runAssessment(
  input: AssessmentInput,
  deps: {
    agent: Agent;
    proposerAgentId: string;
    current(): Promise<Revision | undefined>;
    active(): Promise<boolean>;
  },
  ctx: WorkflowContext,
  now: () => number = Date.now,
): Promise<AssessmentResult> {
  const { tasks } = deps.agent;
  const frozen = await ctx.step('assessment.input', () => {
    if (
      !ctx.executionId ||
      [input.timeoutSec, input.pollIntervalSec].some(
        (value) => !Number.isSafeInteger(value) || value <= 0,
      ) ||
      input.delivery.revision.briefDigest !== input.brief.digest ||
      input.delivery.revision.policyDigest !== input.brief.policyDigest
    )
      throw new Error('Invalid assessment handoff or limits');
    return Promise.resolve(structuredClone(input));
  });
  const revision = frozen.delivery.revision;
  const request = { teamId: frozen.brief.delivery.teamId };
  const source = await ctx.step('assessment.request', async () => {
    const work = frozen.delivery.acceptedWork;
    const task = await tasks.get(work.taskId, request);
    const attempts = await tasks.listAttempts(task.id, request);
    const attempt = attempts.find((value) => value.attemptN === work.attempt);
    if (!attempt || attempt.outputCid !== work.outputCid)
      throw new Error('Assessment source output changed');
    return {
      built: assessmentRequest(frozen.brief, task, attempt),
      producerAgentId: attempt.claimedByAgentId,
    };
  });
  const { built } = source;
  const deadline = await ctx.step('assessment.deadline', () =>
    Promise.resolve(now() + frozen.timeoutSec * 1000),
  );
  const current = async () => {
    if (!(await deps.active())) return false;
    const value = await deps.current();
    return Boolean(value && sameRevision(value, revision));
  };
  const receipt = await createTaskStep(
    ctx,
    'assessment.create',
    ({ idempotencyKey }) => {
      if (!idempotencyKey)
        throw new Error('Missing assessment operation identity');
      return reconcileMoltNetTask({
        tasks,
        teamId: built.teamId,
        proposerAgentId: deps.proposerAgentId,
        body: built.body,
        key: idempotencyKey,
        canDispatch: async () => now() < deadline && (await current()),
      });
    },
  );
  if (!receipt)
    return {
      evidence: { revision, status: 'incomplete' },
      reason: 'assessment:not-dispatched',
    };
  const gate = await beginWorkflowStep<AssessmentResult>(
    ctx,
    'assessment.outcome',
  );
  if (gate.done) return gate.state;
  for (;;) {
    if (!(await current()) || now() >= deadline) {
      await cancelMoltNetTask(
        tasks,
        built.teamId,
        receipt.taskId,
        `assessment:${ctx.executionId}`,
      );
      return completeWorkflowStep(ctx, gate, {
        evidence: { revision, status: 'incomplete' },
        reason: 'assessment:stopped',
      });
    }
    const task = await tasks.get(receipt.taskId, request);
    if (['failed', 'cancelled', 'expired'].includes(task.status))
      return completeWorkflowStep(ctx, gate, {
        evidence: { revision, status: 'incomplete' },
        reason: 'assessment:task-failed',
      });
    if (task.status === 'completed') {
      const attempts = await tasks.listAttempts(task.id, request);
      const attempt = attempts.find(
        (value) => value.attemptN === task.acceptedAttemptN,
      );
      if (
        !attempt ||
        attempt.taskId !== task.id ||
        attempt.status !== 'completed' ||
        !attempt.output ||
        !attempt.outputCid
      )
        return completeWorkflowStep(ctx, gate, {
          evidence: { revision, status: 'incomplete' },
          reason: 'assessment:invalid-output',
        });
      if (attempt.claimedByAgentId === source.producerAgentId)
        return completeWorkflowStep(ctx, gate, {
          evidence: { revision, status: 'incomplete' },
          reason: 'assessment:not-independent',
        });
      const assessment = built.body.input as Parameters<
        Agent['tasks']['buildAssessBrief']
      >[0];
      const criteria = assessment.successCriteria.rubric?.criteria ?? [];
      return completeWorkflowStep(ctx, gate, {
        evidence: evaluateAssessment(criteria, attempt.output, revision),
        acceptedWork: {
          taskId: task.id,
          attempt: attempt.attemptN,
          outputCid: attempt.outputCid,
        },
      });
    }
    await ctx.sleepFor('assessment.poll', frozen.pollIntervalSec);
  }
}
