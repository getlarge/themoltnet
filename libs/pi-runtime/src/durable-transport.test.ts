import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import {
  type ClaimedTask,
  TaskExecutionInterrupted,
} from '@themoltnet/agent-runtime';
import type { RuntimeSessionsNamespace } from '@themoltnet/sdk';
import { afterEach, expect, it, vi } from 'vitest';

import { acquireDurableTransport } from './durable-transport.js';

const claimed = {
  task: { id: 'task', teamId: 'team' },
  attemptN: 1,
  claimAuthority: { leaseId: 'lease', executorFingerprint: 'executor' },
} as ClaimedTask;
afterEach(() => vi.useRealTimers());
it('renews the writer and stops progress on renewal failure', async () => {
  vi.useFakeTimers();
  const handle = {
    storeId: 'store',
    writerToken: 'writer',
    writerExpiresAt: new Date(Date.now() + 30_000).toISOString(),
    format: 'pi-durable.v1',
    headSeq: 0,
  };
  const stores = {
    open: vi.fn(async () => handle),
    renew: vi.fn(async () => {
      throw new Error('fenced');
    }),
    mintId: vi.fn(async () => ({ id: 2 })),
    release: vi.fn(async () => {}),
  };
  const writer = await acquireDurableTransport({
    stores: stores as unknown as RuntimeSessionsNamespace,
    claimed,
    signal: new AbortController().signal,
  });
  expect(await writer.transport.mintId()).toBe(2);
  await vi.advanceTimersByTimeAsync(5_000);
  expect(writer.signal.aborted).toBe(true);
  expect(writer.signal.reason).toMatchObject({
    message: expect.stringContaining('renew (store store)'),
    cause: new Error('fenced'),
  });
  expect(() => writer.check()).toThrow(TaskExecutionInterrupted);
  await expect(writer.transport.mintId()).rejects.toThrow(
    TaskExecutionInterrupted,
  );
  await writer.transport.close(BACKGROUND_CONTEXT);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(stores.renew).toHaveBeenCalledTimes(1);
  expect(stores.release).toHaveBeenCalledTimes(1);
});
it('does not turn a competing writer into a terminal task failure', async () => {
  const stores = {
    open: vi.fn(async () => {
      throw new Error('active writer');
    }),
  };
  await expect(
    acquireDurableTransport({
      stores: stores as unknown as RuntimeSessionsNamespace,
      claimed,
      signal: new AbortController().signal,
    }),
  ).rejects.toBeInstanceOf(TaskExecutionInterrupted);
});

it('identifies an uncertain commit and retains the first failure through cleanup', async () => {
  const failure = new Error('commit acknowledgment timed out');
  const writer = await acquireDurableTransport({
    stores: {
      open: async () => ({
        storeId: 'store',
        writerToken: 'private-writer-token',
        writerExpiresAt: new Date(Date.now() + 30_000).toISOString(),
      }),
      release: async () => {},
    } as unknown as RuntimeSessionsNamespace,
    claimed,
    signal: new AbortController().signal,
  });
  try {
    writer.transport.onUncertainCommit(failure);
    const reason = writer.signal.reason as Error;
    writer.transport.onUncertainCommit(new Error('Harness is closed'));

    expect(writer.signal.reason).toBe(reason);
    expect(reason.message).toContain('commit (store store)');
    expect(reason.message).not.toContain('private-writer-token');
    expect(reason.cause).toBe(failure);
  } finally {
    await writer.transport.close(BACKGROUND_CONTEXT);
  }
});

it('fences the writer when a read body fails after headers', async () => {
  const release = vi.fn(async () => {});
  const writer = await acquireDurableTransport({
    stores: {
      open: async () => ({
        storeId: 'store',
        writerToken: 'writer',
        writerExpiresAt: new Date(Date.now() + 30_000).toISOString(),
      }),
      read: async () => ({
        headSeq: 1,
        items: (async function* () {
          yield { seq: 1, writes: [] };
          throw new Error('truncated stream');
        })(),
      }),
      release,
    } as unknown as RuntimeSessionsNamespace,
    claimed,
    signal: new AbortController().signal,
  });
  try {
    const page = await writer.transport.read(0, BACKGROUND_CONTEXT);
    await expect(
      (async () => {
        for await (const _ of page.items) {
          /* consume */
        }
      })(),
    ).rejects.toBeInstanceOf(TaskExecutionInterrupted);
    expect(writer.signal.aborted).toBe(true);
    expect(writer.signal.reason).toMatchObject({
      message: expect.stringContaining('read_body (store store)'),
      cause: new Error('truncated stream'),
    });
  } finally {
    await writer.transport.close(BACKGROUND_CONTEXT);
  }
});

it('aborts model work at expiry even with a renewal request still in flight', async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  const stores = {
    open: async () => ({
      storeId: 'store',
      writerToken: 'writer',
      writerExpiresAt: new Date(Date.now() + 6_000).toISOString(),
    }),
    renew: vi.fn(
      () =>
        new Promise<{ writerExpiresAt: string }>((resolve) => {
          finish = () =>
            resolve({
              writerExpiresAt: new Date(Date.now() + 30_000).toISOString(),
            });
        }),
    ),
    release: vi.fn(async () => {}),
  };
  const writer = await acquireDurableTransport({
    stores: stores as unknown as RuntimeSessionsNamespace,
    claimed,
    signal: new AbortController().signal,
  });
  await vi.advanceTimersByTimeAsync(5_000);
  expect(writer.signal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1_000);
  expect(writer.signal.aborted).toBe(true);
  finish();
  await vi.advanceTimersByTimeAsync(0);
  expect(() => writer.check()).toThrow(TaskExecutionInterrupted);
  await writer.transport.close(BACKGROUND_CONTEXT);
});

it('reschedules expiry after a confirmed renewal', async () => {
  vi.useFakeTimers();
  const writer = await acquireDurableTransport({
    stores: {
      open: async () => ({
        storeId: 'store',
        writerToken: 'writer',
        writerExpiresAt: new Date(Date.now() + 6_000).toISOString(),
      }),
      renew: async () => ({
        writerExpiresAt: new Date(Date.now() + 30_000).toISOString(),
      }),
      release: async () => {},
    } as unknown as RuntimeSessionsNamespace,
    claimed,
    signal: new AbortController().signal,
  });
  await vi.advanceTimersByTimeAsync(6_000);
  expect(writer.signal.aborted).toBe(false);
  writer.check();
  await writer.transport.close(BACKGROUND_CONTEXT);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(writer.signal.aborted).toBe(false);
});

it('does not rearm expiry when closing during a successful renewal', async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  const writer = await acquireDurableTransport({
    stores: {
      open: async () => ({
        storeId: 'store',
        writerToken: 'writer',
        writerExpiresAt: new Date(Date.now() + 30_000).toISOString(),
      }),
      renew: () =>
        new Promise<{ writerExpiresAt: string }>((resolve) => {
          finish = () =>
            resolve({
              writerExpiresAt: new Date(Date.now() + 30_000).toISOString(),
            });
        }),
      release: async () => {},
    } as unknown as RuntimeSessionsNamespace,
    claimed,
    signal: new AbortController().signal,
  });
  await vi.advanceTimersByTimeAsync(5_000);
  const closing = writer.transport.close(BACKGROUND_CONTEXT);
  finish();
  await closing;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(writer.signal.aborted).toBe(false);
});
