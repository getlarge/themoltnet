import type { Agent } from '@themoltnet/sdk';

const TERMINAL_STATUSES = new Set([
  'completed',
  'failed',
  'cancelled',
  'aborted',
  'timed_out',
]);

/** Best-effort cancellation of every live task in one orchestration run. */
export async function cancelCorrelatedTasks(
  agent: Agent,
  teamId: string,
  correlationId: string,
): Promise<number> {
  const { items } = await agent.tasks.list({ correlationId }, { teamId });
  let cancelled = 0;
  for (const task of items) {
    if (TERMINAL_STATUSES.has(task.status)) continue;
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
