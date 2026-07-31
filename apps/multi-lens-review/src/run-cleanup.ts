import type { Agent } from '@themoltnet/sdk';

const UNCLAIMED_STATUSES = new Set(['waiting', 'queued']);

/**
 * Best-effort cancellation of work that has not started yet.
 *
 * Already-dispatched/running agents are deliberately allowed to finish: an
 * accepted result is durable and can be reused by a recovery run. Cancelling a
 * claimed task races its final submission and destroys otherwise useful work.
 */
export async function cancelCorrelatedTasks(
  agent: Agent,
  teamId: string,
  correlationId: string,
): Promise<number> {
  const { items } = await agent.tasks.list({ correlationId }, { teamId });
  let cancelled = 0;
  for (const task of items) {
    if (!UNCLAIMED_STATUSES.has(task.status)) continue;
    try {
      await agent.tasks.cancel(task.id, {
        reason: 'multi-lens-review run aborted',
      });
      cancelled += 1;
    } catch {
      // Continue cleaning siblings if one task raced to terminal or cancellation
      // failed. Task expiry is the durable backstop for anything left behind.
    }
  }
  return cancelled;
}
