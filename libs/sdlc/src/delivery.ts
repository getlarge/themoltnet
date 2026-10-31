import {
  beginWorkflowStep,
  completeWorkflowStep,
  createTaskStep,
  type WorkflowContext,
} from '@themoltnet/tasks-orchestrator';

import { deliveryRequest, type PreparedBrief } from './brief.js';
import type { AcceptedWork, Handoff, Revision } from './contracts.js';
import type { Admission } from './coordination.js';

export interface DeliveryPort {
  admission(this: void, brief: PreparedBrief): Promise<Admission | undefined>;
  control(
    this: void,
    brief: PreparedBrief,
  ): Promise<'active' | 'paused' | 'cancelled' | 'superseded'>;
  /** Reconcile an existing operation before checking admission/deadline for a new task. */
  start(
    this: void,
    args: {
      key: string;
      brief: PreparedBrief;
      admission: Admission;
      deadline: number;
    },
  ): Promise<{ taskId: string } | null>;
  inspect(
    this: void,
    taskId: string,
  ): Promise<
    | { status: 'pending' }
    | { status: 'failed' }
    | { status: 'accepted'; work: AcceptedWork }
  >;
  cancel(this: void, taskId: string, key: string): Promise<void>;
  /** Verify the accepted output identifies a draft change with the approved scope and current revision. */
  verifyChange(
    this: void,
    brief: PreparedBrief,
    work: AcceptedWork,
  ): Promise<Revision | undefined>;
  publish(this: void, handoff: Handoff, key: string): Promise<boolean>;
}

export type DeliveryResult =
  | { status: 'delivered'; handoff: Handoff; published: boolean }
  | {
      status: 'needs-human' | 'paused' | 'cancelled';
      reason: string;
      taskId?: string;
    };

/** Delivery ends at a verified draft change. Assessment and review are separate stages. */
export async function runDelivery(
  input: { brief: PreparedBrief; timeoutSec: number; pollIntervalSec: number },
  port: DeliveryPort,
  ctx: WorkflowContext,
  now: () => number = Date.now,
): Promise<DeliveryResult> {
  if (!ctx.executionId)
    throw new Error('Delivery requires a stable execution identity');
  const frozen = await ctx.step('delivery.input', () => {
    deliveryRequest(input.brief);
    if (
      [input.timeoutSec, input.pollIntervalSec].some(
        (value) => !Number.isSafeInteger(value) || value <= 0,
      )
    )
      throw new Error('Invalid delivery limits');
    return Promise.resolve(structuredClone(input));
  });
  const { brief } = frozen;
  const admission = await ctx.step('delivery.admission', async () => {
    const value = await port.admission(brief);
    if (
      value &&
      (value.briefDigest !== brief.digest ||
        JSON.stringify(value.workItem) !== JSON.stringify(brief.workItem))
    )
      throw new Error('Admission does not match prepared brief');
    return value ?? null;
  });
  if (!admission)
    return { status: 'needs-human', reason: 'admission:required' };
  const deadline = await ctx.step('delivery.deadline', () =>
    Promise.resolve(now() + frozen.timeoutSec * 1000),
  );
  const receipt = await createTaskStep(
    ctx,
    'delivery.create',
    ({ idempotencyKey }) =>
      port.start({ key: key(idempotencyKey), brief, admission, deadline }),
  );
  if (!receipt)
    return { status: 'needs-human', reason: 'delivery:not-dispatched' };
  const gate = await beginWorkflowStep<
    | { status: 'accepted'; work: AcceptedWork }
    | { status: 'failed' | 'paused' | 'cancelled' | 'superseded' | 'timeout' }
  >(ctx, 'delivery.outcome');
  let outcome = gate.state;
  if (!gate.done) {
    for (;;) {
      const control = await port.control(brief);
      const task = await port.inspect(receipt.taskId);
      const state =
        control !== 'active'
          ? ({ status: control } as const)
          : task.status !== 'pending'
            ? task
            : now() >= deadline
              ? ({ status: 'timeout' } as const)
              : undefined;
      if (state) {
        outcome = await completeWorkflowStep(ctx, gate, state);
        break;
      }
      await ctx.sleepFor('delivery.poll', frozen.pollIntervalSec);
    }
  }
  if (!outcome) throw new Error('Missing delivery outcome');
  if (outcome.status !== 'accepted') {
    if (outcome.status !== 'failed')
      await createTaskStep(
        ctx,
        'delivery.cancel',
        async ({ idempotencyKey }) => {
          await port.cancel(receipt.taskId, key(idempotencyKey));
          return true;
        },
      );
    return {
      status:
        outcome.status === 'paused' || outcome.status === 'cancelled'
          ? outcome.status
          : 'needs-human',
      reason: `delivery:${outcome.status}`,
      taskId: receipt.taskId,
    };
  }
  if (outcome.work.taskId !== receipt.taskId)
    throw new Error('Accepted task identity mismatch');
  const revision = await ctx.step(
    'delivery.verify',
    async () => (await port.verifyChange(brief, outcome.work)) ?? null,
  );
  if (
    !revision ||
    revision.briefDigest !== brief.digest ||
    revision.policyDigest !== brief.policyDigest
  )
    return {
      status: 'needs-human',
      reason: 'delivery:invalid-change',
      taskId: receipt.taskId,
    };
  const handoff: Handoff = {
    version: 1,
    workItem: brief.workItem,
    generation: admission.approvalEventId,
    correlationId: brief.delivery.body.correlationId ?? '',
    revision,
    acceptedWork: outcome.work,
  };
  const published = await createTaskStep(
    ctx,
    'delivery.publish',
    ({ idempotencyKey }) => port.publish(handoff, key(idempotencyKey)),
  );
  return { status: 'delivered', handoff, published };
}
function key(value: string | undefined): string {
  if (!value) throw new Error('Missing durable operation key');
  return value;
}
