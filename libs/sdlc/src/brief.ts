import { createHash } from 'node:crypto';

import {
  buildAssessBrief,
  buildFulfillBrief,
  type BuiltTask,
} from '@themoltnet/sdk';
import type { SdkTask, SdkTaskAttempt } from '@themoltnet/tasks-orchestrator';

import type { WorkItemRef } from './contracts.js';

type FulfillInput = Parameters<typeof buildFulfillBrief>[0];
export interface StageExecutorPolicy {
  profileId: string;
  maxAttempts: number;
  dispatchTimeoutSec: number;
  runningTimeoutSec: number;
}
export interface PreparedBrief {
  version: 1;
  workItem: WorkItemRef;
  policyDigest: string;
  delivery: BuiltTask;
  assessment: StageExecutorPolicy;
  digest: string;
}

/** Prepare the exact normalized criteria and task requests before seeking approval. */
export function prepareBrief(input: {
  workItem: WorkItemRef;
  policyDigest: string;
  teamId: string;
  diaryId: string;
  correlationId: string;
  brief: FulfillInput;
  delivery: StageExecutorPolicy;
  assessment: StageExecutorPolicy;
}): PreparedBrief {
  if (
    !input.policyDigest ||
    !input.brief.successCriteria?.rubric?.criteria.length
  )
    throw new Error(
      'SDLC briefs require a policy digest and explicit assessment rubric',
    );
  validateExecutor(input.delivery);
  validateExecutor(input.assessment);
  const delivery = buildFulfillBrief(input.brief)
    .team(input.teamId)
    .diary(input.diaryId)
    .correlationId(input.correlationId)
    .maxAttempts(input.delivery.maxAttempts)
    .dispatchTimeoutSec(input.delivery.dispatchTimeoutSec)
    .runningTimeoutSec(input.delivery.runningTimeoutSec)
    .allowProfiles({ profileId: input.delivery.profileId })
    .build();
  const value = JSON.parse(
    JSON.stringify({
      version: 1,
      workItem: input.workItem,
      policyDigest: input.policyDigest,
      delivery,
      assessment: input.assessment,
    }),
  ) as Omit<PreparedBrief, 'digest'>;
  return { ...value, digest: digest(value) };
}

/** Refuse an edited handoff instead of silently changing an approved task. */
export function deliveryRequest(brief: PreparedBrief): BuiltTask {
  assertBrief(brief);
  return structuredClone(brief.delivery);
}

export function assessmentRequest(
  brief: PreparedBrief,
  task: SdkTask,
  attempt: SdkTaskAttempt,
): BuiltTask {
  assertBrief(brief);
  if (
    task.status !== 'completed' ||
    task.acceptedAttemptN !== attempt.attemptN ||
    attempt.status !== 'completed' ||
    attempt.taskId !== task.id ||
    !attempt.outputCid ||
    !attempt.output ||
    task.taskType !== 'fulfill_brief' ||
    task.teamId !== brief.delivery.teamId ||
    task.diaryId !== brief.delivery.body.diaryId ||
    digest(task.input) !== digest(brief.delivery.body.input)
  )
    throw new Error(
      'Assessment requires accepted work from the approved brief',
    );
  const source = brief.delivery.body.input as FulfillInput;
  const rubric = source.successCriteria?.rubric;
  const correlationId = brief.delivery.body.correlationId;
  if (!rubric || !correlationId)
    throw new Error('Prepared brief has no rubric or correlation');
  // Producer output assertions/gates do not apply to the assessor output.
  // The rubric itself is copied exactly; the assessor cannot invent a new spec.
  const policy = brief.assessment;
  return buildAssessBrief({
    targetTaskId: task.id,
    successCriteria: { version: 1, rubric: structuredClone(rubric) },
  })
    .team(brief.delivery.teamId)
    .diary(brief.delivery.body.diaryId)
    .correlationId(correlationId)
    .references(
      { taskId: task.id, outputCid: attempt.outputCid },
      'judged_work',
    )
    .maxAttempts(policy.maxAttempts)
    .dispatchTimeoutSec(policy.dispatchTimeoutSec)
    .runningTimeoutSec(policy.runningTimeoutSec)
    .allowProfiles({ profileId: policy.profileId })
    .build();
}

function assertBrief(brief: PreparedBrief): void {
  const { digest: expected, ...value } = brief;
  if (brief.version !== 1 || digest(value) !== expected)
    throw new Error('Prepared brief digest mismatch');
}
function validateExecutor(policy: StageExecutorPolicy): void {
  if (
    !policy.profileId ||
    !Number.isInteger(policy.maxAttempts) ||
    policy.maxAttempts < 1 ||
    policy.maxAttempts > 10 ||
    [policy.dispatchTimeoutSec, policy.runningTimeoutSec].some(
      (value) => !Number.isSafeInteger(value) || value < 1 || value > 86400,
    )
  )
    throw new Error('Invalid stage executor limits');
}
function digest(value: unknown): string {
  return createHash('sha256')
    .update(
      JSON.stringify(value, (_key, item: unknown) => {
        if (item && typeof item === 'object' && !Array.isArray(item))
          return Object.fromEntries(
            Object.entries(item).sort(([a], [b]) =>
              a < b ? -1 : a > b ? 1 : 0,
            ),
          );
        return item;
      }),
    )
    .digest('hex');
}
