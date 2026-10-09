import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createMockServices,
  createTestApp,
  VALID_AUTH_CONTEXT,
} from './helpers.js';

const teamId = 'bbbbbbbb-0000-0000-0000-000000000002';
const taskId = 'aaaaaaaa-0000-0000-0000-000000000001';
const storeId = 'eeeeeeee-0000-0000-0000-000000000005';
const headers = {
  authorization: 'Bearer test-token',
  'x-moltnet-team-id': teamId,
};
const path = `/tasks/${taskId}/attempts/1/conversations`;

describe('task conversation routes', () => {
  let app: FastifyInstance;
  let mocks: ReturnType<typeof createMockServices>;
  afterEach(async () => app.close());
  beforeEach(async () => {
    mocks = createMockServices();
    mocks.permissionChecker.canAccessTeam.mockResolvedValue(true);
    mocks.permissionChecker.canViewTask.mockResolvedValue(true);
    const repo = mocks.runtimeSessionRepository.durable;
    repo.findAttempt.mockResolvedValue({
      storeId,
      teamId,
      taskId,
      attemptN: 1,
    });
    repo.listAttempts.mockResolvedValue([{ taskId, attemptN: 1 }]);
    repo.get.mockResolvedValue({
      id: storeId,
      format: 'pi-durable.v1',
      headSeq: 1,
      writerTaskId: taskId,
      writerAttemptN: 1,
      writerExpiresAt: new Date(Date.now() + 60_000),
    });
    repo.attemptBounds.mockResolvedValue({ firstSeq: 1, lastSeq: 1 });
    mocks.taskRepository.findAttempt.mockResolvedValue({ status: 'running' });
    const bytes = Buffer.from(
      JSON.stringify({
        format: 'pi-durable.v1',
        writes: [
          { type: 'conversation', value: { id: 1 } },
          {
            type: 'document.create',
            record: {
              id: 2,
              kind: 'moltnet.attempt',
              key: `${taskId}/1`,
              scope: { kind: 'session' },
            },
            content: { version: 1, kind: 'base', value: { conversationId: 1 } },
          },
          {
            type: 'document.create',
            record: {
              id: 3,
              kind: 'pi.live',
              scope: { kind: 'conversation', conversationId: 1 },
              history: 'latest',
              fork: 'initial',
            },
            content: {
              version: 1,
              kind: 'base',
              value: {
                generation: {
                  attempt: 1,
                  message: {
                    role: 'assistant',
                    content: [{ type: 'text', text: 'Saved partial' }],
                  },
                },
              },
            },
          },
        ],
      }),
    );
    repo.listCommits.mockImplementation(async (_store, after) =>
      after === 0
        ? [
            {
              seq: 1,
              commitId: 'commit',
              objectKey: 'object',
              sha256: createHash('sha256').update(bytes).digest('hex'),
            },
          ]
        : [],
    );
    mocks.runtimeSessionStorage.getObject.mockImplementation(async () => ({
      body: Readable.from([bytes]),
    }));
    app = await createTestApp(mocks, VALID_AUTH_CONTEXT);
  });
  it('returns assembled saved content without acquiring a writer or executing a task', async () => {
    const listed = await app.inject({ method: 'GET', url: path, headers });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual({
      items: [
        { conversationId: '1', parentConversationId: null, kind: 'main' },
      ],
    });
    const result = await app.inject({
      method: 'GET',
      url: `${path}/1`,
      headers,
    });
    expect(result.statusCode).toBe(200);
    expect(result.json().messages[0]).toMatchObject({
      status: 'streaming',
      message: { content: [{ text: 'Saved partial' }] },
    });
    expect(
      mocks.runtimeSessionRepository.durable.lockAuthority,
    ).not.toHaveBeenCalled();
    expect(
      mocks.runtimeSessionRepository.durable.append,
    ).not.toHaveBeenCalled();
    expect(mocks.taskRepository.appendMessages).not.toHaveBeenCalled();
  });
  it('denies inaccessible shared-store tasks before reading any blobs', async () => {
    mocks.permissionChecker.canViewTask.mockImplementation(
      async (id) => id === taskId,
    );
    mocks.runtimeSessionRepository.durable.listAttempts.mockResolvedValue([
      { taskId: 'another-task' },
    ]);
    const result = await app.inject({
      method: 'GET',
      url: `${path}/1`,
      headers,
    });
    expect(result.statusCode).toBe(404);
    expect(mocks.runtimeSessionStorage.getObject).not.toHaveBeenCalled();
  });
  it('rejects unbound conversations and invalid history cursors', async () => {
    expect(
      (await app.inject({ method: 'GET', url: `${path}/99`, headers }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `${path}/1?beforeEntryId=wat`,
          headers,
        })
      ).statusCode,
    ).toBe(400);
  });
  it('starts SSE with a replacement snapshot and releases the reader on disconnect', async () => {
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const controller = new AbortController();
    try {
      const response = await fetch(`${address}${path}/1/events`, {
        headers: { ...headers, 'Last-Event-ID': 'old-revision' },
        signal: controller.signal,
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain(
        'text/event-stream',
      );
      const stream = response.body!.getReader();
      const frame = new TextDecoder().decode((await stream.read()).value);
      expect(frame).toContain('event: conversation.snapshot');
      expect(frame).toContain('Saved partial');
      await stream.cancel();
    } finally {
      controller.abort();
    }
  });
});
