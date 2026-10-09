import { expect, it, vi } from 'vitest';

import { createMoltNetTools, type MoltNetToolsConfig } from './tools.js';

it('reads assembled conversations through the task API with team and cancellation', async () => {
  const get = vi.fn().mockResolvedValue({
    messages: [{ message: { content: 'saved evidence' } }],
  });
  const config: MoltNetToolsConfig = {
    getAgent: () =>
      ({ tasks: { conversations: { get } } }) as unknown as ReturnType<
        MoltNetToolsConfig['getAgent']
      >,
    getDiaryId: () => 'diary',
    getTeamId: () => 'team',
    getSessionErrors: () => [],
    clearSessionErrors: () => {},
  };
  const tool = createMoltNetTools(config).find(
    (t) => t.name === 'moltnet_read_task_conversation',
  )!;
  const signal = new AbortController().signal;
  const result = await tool.execute(
    'call',
    { taskId: 'task', attemptN: 1, conversationId: '1' },
    signal,
    undefined,
    {} as never,
  );
  expect(get).toHaveBeenCalledExactlyOnceWith(
    'task',
    1,
    '1',
    { teamId: 'team', signal },
    { beforeEntryId: undefined, limit: undefined },
  );
  expect(JSON.stringify(result.content)).toContain('saved evidence');
});
