import { assessmentRequest, deliveryRequest } from './brief.js';
import type { DeliveryPort } from './delivery.js';
import {
  cancelMoltNetTask,
  type MoltNetTasks,
  reconcileMoltNetTask,
} from './moltnet-repair.js';

/** Bind task execution to MoltNet; repository admission and draft verification stay in the provider adapter. */
export function createMoltNetDeliveryPort(input: {
  tasks: MoltNetTasks;
  teamId: string;
  proposerAgentId: string;
  repository: Pick<
    DeliveryPort,
    'admission' | 'control' | 'verifyChange' | 'publish'
  >;
  now?: () => number;
}): DeliveryPort {
  const { tasks, teamId, repository } = input;
  const request = { teamId };
  return {
    ...repository,
    async start({ key, brief, admission, deadline }) {
      const built = deliveryRequest(brief);
      if (built.teamId !== teamId) throw new Error('Delivery team mismatch');
      return reconcileMoltNetTask({
        tasks,
        teamId,
        proposerAgentId: input.proposerAgentId,
        key,
        body: built.body,
        canDispatch: async () => {
          if (
            (input.now ?? Date.now)() >= deadline ||
            (await repository.control(brief)) !== 'active'
          )
            return false;
          const current = await repository.admission(brief);
          return (
            current?.approvalEventId === admission.approvalEventId &&
            current.briefDigest === admission.briefDigest
          );
        },
      });
    },
    async inspect(taskId) {
      const task = await tasks.get(taskId, request);
      if (task.status !== 'completed')
        return {
          status: ['failed', 'cancelled', 'expired'].includes(task.status)
            ? 'failed'
            : 'pending',
        };
      const attempts = await tasks.listAttempts(taskId, request);
      const attempt = attempts.find(
        (value) => value.attemptN === task.acceptedAttemptN,
      );
      if (
        !attempt ||
        attempt.taskId !== taskId ||
        attempt.status !== 'completed' ||
        !attempt.outputCid ||
        !attempt.output
      )
        return { status: 'failed' };
      return {
        status: 'accepted',
        work: {
          taskId,
          attempt: attempt.attemptN,
          outputCid: attempt.outputCid,
        },
      };
    },
    async cancel(taskId, key) {
      await cancelMoltNetTask(tasks, teamId, taskId, key);
    },
    async verifyChange(brief, work) {
      const task = await tasks.get(work.taskId, request);
      const attempts = await tasks.listAttempts(work.taskId, request);
      const attempt = attempts.find((value) => value.attemptN === work.attempt);
      if (!attempt || attempt.outputCid !== work.outputCid) return undefined;
      // Also checks task type, team, accepted attempt, and exact approved input.
      assessmentRequest(brief, task, attempt);
      return repository.verifyChange(brief, work);
    },
  };
}
