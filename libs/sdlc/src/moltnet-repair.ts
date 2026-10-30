import { createHash } from 'node:crypto';

import type { Agent, CreateTaskBody, TaskCreateOptions } from '@themoltnet/sdk';

import type { AcceptedWork } from './contracts.js';
import type { ConvergencePort } from './convergence.js';

type Start = Parameters<ConvergencePort['startRepair']>[0];
export type MoltNetTasks = Pick<
  Agent['tasks'],
  'list' | 'get' | 'listAttempts' | 'cancel'
> & {
  create(
    body: CreateTaskBody,
    options: TaskCreateOptions,
  ): ReturnType<Agent['tasks']['get']>;
};

/** Configuration and body must come from the durable, approved policy snapshot. */
export function createMoltNetRepairAdapter(options: {
  tasks: MoltNetTasks;
  teamId: string;
  proposerAgentId: string;
  now?: () => number;
  body(args: Start): CreateTaskBody;
  canDispatch(args: Start): Promise<boolean>;
  verifyOutput(
    output: Record<string, unknown>,
    accepted: AcceptedWork,
  ): boolean;
}): Pick<ConvergencePort, 'startRepair' | 'repairState' | 'cancelRepair'> {
  const { tasks, teamId } = options;
  const request = { teamId };
  const terminal = new Set(['completed', 'failed', 'cancelled', 'expired']);
  return {
    async startRepair(args) {
      return reconcileMoltNetTask({
        tasks,
        teamId,
        proposerAgentId: options.proposerAgentId,
        body: options.body(args),
        key: args.key,
        canDispatch: () =>
          (options.now ?? Date.now)() >= args.deadline
            ? Promise.resolve(false)
            : options.canDispatch(args),
      });
    },
    async repairState({ taskId }) {
      const task = await tasks.get(taskId, request);
      if (task.status !== 'completed')
        return terminal.has(task.status) ? 'failed' : 'pending';
      if (task.acceptedAttemptN === null) return 'failed';
      const attempts = await tasks.listAttempts(taskId, request);
      const accepted = attempts.find(
        (attempt) => attempt.attemptN === task.acceptedAttemptN,
      );
      if (
        !accepted ||
        accepted.taskId !== taskId ||
        accepted.status !== 'completed' ||
        !accepted.outputCid ||
        !accepted.output
      )
        return 'failed';
      return options.verifyOutput(accepted.output, {
        taskId,
        attempt: accepted.attemptN,
        outputCid: accepted.outputCid,
      })
        ? 'accepted'
        : 'failed';
    },
    async cancelRepair({ taskId }, key) {
      await cancelMoltNetTask(tasks, teamId, taskId, key);
    },
  };
}

/** Shared reconciliation for delivery and repair; SDK create enforces key/body identity. */
export async function reconcileMoltNetTask(input: {
  tasks: MoltNetTasks;
  teamId: string;
  proposerAgentId: string;
  body: CreateTaskBody;
  key: string;
  canDispatch(): Promise<boolean>;
}): Promise<{ taskId: string } | null> {
  const { tasks, teamId } = input;
  const request = { teamId };
  // The operation tag locates a lost acknowledgement; the create endpoint remains
  // authoritative for key/body agreement and concurrent-create uniqueness.
  const digest = createHash('sha256').update(input.key).digest('hex');
  const operationTag = `sdlc-operation:${digest}`;
  const body = input.body;
  const snapshot = {
    ...body,
    tags: [...new Set([...(body.tags ?? []), operationTag])],
  };
  const existing = await tasks.list(
    {
      tags: [operationTag],
      proposedByAgentId: input.proposerAgentId,
      limit: 2,
    },
    request,
  );
  if (existing.items.length > 1) throw new Error('Ambiguous repair operation');
  if (existing.items.length === 0 && !(await input.canDispatch())) return null;
  const task = await tasks.create(snapshot, {
    ...request,
    idempotencyKey: input.key,
  });
  if (existing.items.length && task.id !== existing.items[0].id)
    throw new Error('Repair operation identity mismatch');
  return { taskId: task.id };
}

export async function cancelMoltNetTask(
  tasks: MoltNetTasks,
  teamId: string,
  taskId: string,
  key: string,
): Promise<void> {
  const request = { teamId };
  const terminal = new Set(['completed', 'failed', 'cancelled', 'expired']);
  if (terminal.has((await tasks.get(taskId, request)).status)) return;
  try {
    await tasks.cancel(
      taskId,
      { reason: `SDLC stage stopped (${key})` },
      request,
    );
  } catch (error) {
    // A successful cancellation can lose its acknowledgement, or completion
    // can race the request. Only a fresh terminal observation settles it.
    if (!terminal.has((await tasks.get(taskId, request)).status)) throw error;
  }
}
