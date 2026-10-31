import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

import type { RuntimeStoreRepository } from '@moltnet/database';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as requestSignals from '../src/utils/request-abort-signal.js';
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
  let saved: Buffer;
  afterEach(async () => app.close());
  beforeEach(async () => {
    mocks = createMockServices();
    mocks.permissionChecker.canAccessTeam.mockResolvedValue(true);
    mocks.permissionChecker.canViewTask.mockResolvedValue(true);
    mocks.permissionChecker.canViewTasks.mockImplementation(
      async (ids: string[]) => new Map(ids.map((id) => [id, true])),
    );
    const repo = mocks.runtimeSessionRepository.durable;
    type Row = NonNullable<
      Awaited<ReturnType<RuntimeStoreRepository['conversationRecord']>>
    >;
    const projected: Row[] = [];
    let projectedHead = 0;
    repo.conversationHead.mockImplementation(async () => projectedHead);
    repo.saveConversationRecords.mockImplementation(
      async (
        storeId: string,
        seq: number,
        rows: Omit<Row, 'storeId' | 'seq'>[],
      ) => {
        projected.push(...rows.map((row) => ({ ...row, storeId, seq })));
        projectedHead = seq;
      },
    );
    repo.conversationRecord.mockImplementation(
      async (_store, type, id, seq) =>
        projected
          .filter((r) => r.type === type && r.id === id && r.seq <= seq)
          .sort((a, b) => b.seq - a.seq)[0],
    );
    repo.conversationDocument.mockImplementation(
      async (_store, address, seq) =>
        projected
          .filter((r) => r.address === address && r.seq <= seq)
          .sort((a, b) => b.seq - a.seq)[0],
    );
    repo.conversationList.mockImplementation(async (_store, seq) =>
      projected.filter((r) => r.type === 'conversation' && r.seq <= seq),
    );
    repo.lock.mockImplementation(async () => repo.get(teamId, storeId));
    repo.findAttempt.mockResolvedValue({
      storeId,
      teamId,
      taskId,
      attemptN: 1,
    });
    repo.listAttempts.mockResolvedValue([{ taskId, attemptN: 1 }]);
    repo.listCommitTaskIds.mockResolvedValue([taskId]);
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
    saved = bytes;
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
    expect(mocks.runtimeSessionStorage.getObject).toHaveBeenCalledTimes(1);
  });
  it('fetches cold history objects concurrently on the conversation route', async () => {
    const repo = mocks.runtimeSessionRepository.durable;
    const empty = Buffer.from(
      JSON.stringify({ format: 'pi-durable.v1', writes: [] }),
    );
    const objects = new Map<string, Buffer>([
      ['object', saved],
      ['empty-2', empty],
      ['empty-3', empty],
      ['empty-4', empty],
    ]);
    repo.get.mockResolvedValue({
      ...(await repo.get(teamId, storeId)),
      headSeq: 4,
    });
    repo.attemptBounds.mockResolvedValue({ firstSeq: 1, lastSeq: 4 });
    repo.listCommits.mockImplementation(async (_store, after: number) =>
      [...objects].slice(after).map(([objectKey, bytes], index) => ({
        seq: after + index + 1,
        commitId: objectKey,
        objectKey,
        sizeBytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      })),
    );
    let inflight = 0;
    let maxInflight = 0;
    mocks.runtimeSessionStorage.getObject.mockImplementation(
      async (key: string) => {
        inflight++;
        maxInflight = Math.max(maxInflight, inflight);
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 10);
        });
        inflight--;
        return { body: Readable.from([objects.get(key)!]) };
      },
    );

    const listed = await app.inject({ method: 'GET', url: path, headers });

    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual({
      items: [
        { conversationId: '1', parentConversationId: null, kind: 'main' },
      ],
    });
    expect(mocks.runtimeSessionStorage.getObject).toHaveBeenCalledTimes(4);
    expect(maxInflight).toBe(4);
  });
  it('denies inaccessible shared-store tasks before reading any blobs', async () => {
    mocks.permissionChecker.canViewTasks.mockImplementation(
      async (ids: string[]) => new Map(ids.map((id) => [id, id === taskId])),
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
  it('reauthorizes copied ancestors on cached reads with no new commits', async () => {
    mocks.runtimeSessionRepository.durable.listCommitTaskIds.mockResolvedValue([
      taskId,
      'ancestor',
    ]);
    expect(
      (await app.inject({ method: 'GET', url: `${path}/1`, headers }))
        .statusCode,
    ).toBe(200);
    mocks.permissionChecker.canViewTasks.mockImplementation(
      async (ids: string[]) =>
        new Map(ids.map((id) => [id, id !== 'ancestor'])),
    );
    expect(
      (await app.inject({ method: 'GET', url: `${path}/1`, headers }))
        .statusCode,
    ).toBe(404);
    expect(mocks.runtimeSessionStorage.getObject).toHaveBeenCalledTimes(1);
  });

  it.each(['', '/1', '/1/events'])(
    'aborts backing object reads when %s disconnects during initial replay',
    async (suffix) => {
      let readSignal: AbortSignal | undefined;
      mocks.runtimeSessionStorage.getObject.mockImplementation(
        (_key, signal) => {
          readSignal = signal;
          return new Promise((_resolve, reject) => {
            signal!.addEventListener('abort', () => reject(signal!.reason), {
              once: true,
            });
          });
        },
      );
      const address = await app.listen({ host: '127.0.0.1', port: 0 });
      const controller = new AbortController();
      const response = fetch(`${address}${path}${suffix}`, {
        headers,
        signal: controller.signal,
      });
      const failed = expect(response).rejects.toThrow();
      await vi.waitFor(() => expect(readSignal).toBeDefined());
      controller.abort();
      await failed;
      await vi.waitFor(() => expect(readSignal!.aborted).toBe(true));
    },
  );

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
  it('closes a backpressured response and its reader when its lifetime expires', async () => {
    const lifetime = new AbortController();
    const timeout = vi
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(lifetime.signal);
    const from = Readable.from;
    let output: Readable | undefined;
    const streams = vi
      .spyOn(Readable, 'from')
      .mockImplementation((source, options) => {
        const stream = from(source, options);
        if (options?.signal) output = stream;
        return stream;
      });
    const controller = new AbortController();
    try {
      const address = await app.listen({ host: '127.0.0.1', port: 0 });
      const response = await fetch(`${address}${path}/1/events`, {
        headers,
        signal: controller.signal,
      });
      await response.body!.getReader().read();
      expect(output).toBeDefined();
      output!.pause();
      // Suspend the generator at its next yield, rather than in its polling wait.
      await vi.waitFor(
        () => expect(output!.readableLength).toBeGreaterThan(0),
        { timeout: 3000 },
      );
      lifetime.abort();
      await vi.waitFor(() => {
        expect(output!.destroyed).toBe(true);
      });
    } finally {
      controller.abort();
      timeout.mockRestore();
      streams.mockRestore();
    }
  });

  it('releases readers even when the response is destroyed before its first pull', async () => {
    let lifetime = new AbortController();
    const timeout = vi
      .spyOn(AbortSignal, 'timeout')
      .mockImplementation(() => lifetime.signal);
    const from = Readable.from;
    const streams = vi
      .spyOn(Readable, 'from')
      .mockImplementation((source, options) => {
        if (options?.signal) lifetime.abort();
        return from(source, options);
      });
    try {
      const address = await app.listen({ host: '127.0.0.1', port: 0 });
      // More than the reader limit: every pre-start cancellation must release its slot.
      for (let i = 0; i < 17; i++) {
        lifetime = new AbortController();
        const response = await fetch(`${address}${path}/1/events`, {
          headers,
        }).catch(() => null);
        if (response) {
          expect(response.status).not.toBe(503);
          await response.text().catch(() => undefined);
        }
      }
      lifetime = new AbortController();
      expect(
        (await app.inject({ method: 'GET', url: `${path}/1`, headers }))
          .statusCode,
      ).toBe(200);
    } finally {
      timeout.mockRestore();
      streams.mockRestore();
    }
  });

  it('drains active watchers before onClose without waiting for their deadline', async () => {
    const controller = new AbortController();
    try {
      const address = await app.listen({ host: '127.0.0.1', port: 0 });
      const response = await fetch(`${address}${path}/1/events`, {
        headers,
        signal: controller.signal,
      });
      const stream = response.body!.getReader();
      await stream.read();
      let closed = false;
      const closing = app.close().then(() => {
        closed = true;
      });
      // No client cancellation until after the assertion: the server must drain
      // the response itself, well within Fly's 30-second termination grace.
      await vi.waitFor(() => expect(closed).toBe(true), { timeout: 2000 });
      await closing;
      const calls =
        mocks.runtimeSessionRepository.durable.get.mock.calls.length;
      await new Promise((resolve) => {
        setTimeout(resolve, 1100);
      });
      expect(mocks.runtimeSessionRepository.durable.get).toHaveBeenCalledTimes(
        calls,
      );
    } finally {
      controller.abort();
    }
  });

  it.each(['', '/1', '/1/events'])(
    'skips replay when %s disconnected before authentication completed',
    async (suffix) => {
      let disconnected = false;
      app.server.once('request', (_request, response) => {
        response.once('close', () => {
          disconnected = true;
        });
      });
      const address = await app.listen({ host: '127.0.0.1', port: 0 });
      const gate = Promise.withResolvers<void>();
      const auth = vi.spyOn(app.tokenValidator, 'resolveAuthContext');
      auth.mockImplementationOnce(async () => {
        await gate.promise;
        return {
          ...VALID_AUTH_CONTEXT,
          scopes: [...VALID_AUTH_CONTEXT.scopes],
        };
      });
      const signals = vi.spyOn(requestSignals, 'requestAbortSignal');
      const controller = new AbortController();
      try {
        const response = fetch(`${address}${path}${suffix}`, {
          headers,
          signal: controller.signal,
        });
        const failed = expect(response).rejects.toThrow();
        await vi.waitFor(() => expect(auth).toHaveBeenCalled());
        controller.abort();
        await failed;
        await vi.waitFor(() => expect(disconnected).toBe(true));
        gate.resolve();
        await vi.waitFor(() => expect(signals).toHaveBeenCalled());
        expect(signals.mock.results[0].value.aborted).toBe(true);
        expect(mocks.taskRepository.findAttempt).not.toHaveBeenCalled();
        expect(mocks.runtimeSessionStorage.getObject).not.toHaveBeenCalled();
      } finally {
        gate.resolve();
        controller.abort();
        auth.mockRestore();
        signals.mockRestore();
      }
    },
  );

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
