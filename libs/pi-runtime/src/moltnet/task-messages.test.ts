import { expect, it, vi } from 'vitest';

import { createMoltNetTools, type MoltNetToolsConfig } from './tools.js';

function setup(missing = false) {
  const entries = [2, 3].map((id) => ({
    id,
    kind: 'pi.assistant',
    model: [{ content: `evidence-${id}` }],
  }));
  const read = vi.fn().mockResolvedValue({
    headSeq: 4,
    items: (async function* () {
      if (!missing)
        yield {
          seq: 4,
          writes: entries.map((value) => ({ type: 'entry', value })),
        };
    })(),
  });
  const listMessages = vi.fn().mockResolvedValue([
    { seq: 1, payload: { event: 'other', text: 'legacy event' } },
    ...entries.map((entry) => ({
      seq: entry.id,
      payload: {
        event: 'runtime_entry',
        format: 'pi-durable.v1',
        storeId: 'store',
        commitSeq: 4,
        entryId: entry.id,
      },
    })),
  ]);
  const config: MoltNetToolsConfig = {
    getAgent: () =>
      ({
        tasks: { listMessages },
        runtimeSessions: { read },
      }) as unknown as ReturnType<MoltNetToolsConfig['getAgent']>,
    getDiaryId: () => 'diary',
    getTeamId: () => 'team',
    getSessionErrors: () => [],
    clearSessionErrors: () => {},
  };
  const tool = createMoltNetTools(config).find(
    (t) => t.name === 'moltnet_list_task_messages',
  )!;
  return { read, tool };
}

it('resolves Durable entry references once per commit while retaining ordinary events', async () => {
  const { read, tool } = setup();
  const signal = new AbortController().signal;
  const result = await tool.execute(
    'call',
    { taskId: 'task', attemptN: 1 },
    signal,
    undefined,
    {} as never,
  );
  expect(read).toHaveBeenCalledExactlyOnceWith('store', 3, {
    teamId: 'team',
    signal,
  });
  expect(JSON.stringify(result.content)).toContain('evidence-2');
  expect(JSON.stringify(result.content)).toContain('evidence-3');
  expect(JSON.stringify(result.content)).toContain('legacy event');
});

it('reports missing Durable evidence instead of silently returning empty history', async () => {
  const { tool } = setup(true);
  await expect(
    tool.execute(
      'call',
      { taskId: 'task', attemptN: 1 },
      undefined,
      undefined,
      {} as never,
    ),
  ).rejects.toThrow('commit is unavailable');
});
