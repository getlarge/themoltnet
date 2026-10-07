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
  } finally {
    await writer.transport.close(BACKGROUND_CONTEXT);
  }
});
