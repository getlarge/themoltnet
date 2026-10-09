import { createClient } from '@moltnet/api-client';
import { expect, it, vi } from 'vitest';

import { createTasksNamespace } from '../../src/namespaces/tasks.js';

const snapshot = {
  conversationId: '1',
  cursor: 'revision',
  attemptStatus: 'running',
  messages: [],
  nextBeforeEntryId: null,
  live: {},
};

it('reads task-scoped conversations with team headers and history pagination', async () => {
  const fetch = vi.fn(async (_request: RequestInfo | URL) =>
    Response.json(snapshot),
  );
  const client = createClient({ baseUrl: 'https://example.test', fetch });
  const tasks = createTasksNamespace({ client });
  expect(
    await tasks.conversations.get(
      'task',
      2,
      '1',
      { teamId: 'team' },
      { beforeEntryId: '5' },
    ),
  ).toEqual(snapshot);
  const request = fetch.mock.calls[0][0] as Request;
  expect(request.url).toContain(
    '/tasks/task/attempts/2/conversations/1?beforeEntryId=5',
  );
  expect(request.headers.get('x-moltnet-team-id')).toBe('team');
});

it('replaces snapshots and aborts the HTTP request when the consumer leaves watch', async () => {
  let request: Request | undefined;
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    request = new Request(input);
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              `id: revision\nevent: conversation.snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`,
            ),
          );
        },
      }),
      { headers: { 'content-type': 'text/event-stream' } },
    );
  });
  const tasks = createTasksNamespace({
    client: createClient({ baseUrl: 'https://example.test', fetch }),
  });
  for await (const value of tasks.conversations.watch('task', 2, '1', {
    teamId: 'team',
  })) {
    expect(value).toEqual(snapshot);
    break;
  }
  expect(request?.signal.aborted).toBe(true);
});

it('rejects malformed snapshots instead of presenting empty conversation state', async () => {
  const fetch = vi.fn(
    async () =>
      new Response('event: conversation.snapshot\ndata: {}\n\n', {
        headers: { 'content-type': 'text/event-stream' },
      }),
  );
  const tasks = createTasksNamespace({
    client: createClient({ baseUrl: 'https://example.test', fetch }),
  });
  const snapshots = tasks.conversations.watch('task', 2, '1', {
    teamId: 'team',
  });
  const stream = snapshots[Symbol.asyncIterator]();
  await expect(stream.next()).rejects.toThrow('Invalid conversation snapshot');
});
