import {
  BACKGROUND_CONTEXT,
  withAbortSignal,
} from '@earendil-works/chord/context';
import {
  type ClaimedTask,
  TaskExecutionInterrupted,
} from '@themoltnet/agent-runtime';
import {
  MoltNetError,
  NetworkError,
  type RuntimeSessionsNamespace,
} from '@themoltnet/sdk';
import { afterEach, expect, it, vi } from 'vitest';

import { acquireDurableTransport } from '../src/durable-transport.js';

const claimed = {
  task: { id: 'task', teamId: 'team' },
  attemptN: 1,
  claimAuthority: { leaseId: 'lease', executorFingerprint: 'executor' },
} as ClaimedTask;
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it.each([
  { headerMs: 6_000, processingMs: 0 },
  { headerMs: 0, processingMs: 15_000 },
])(
  'keeps replay alive with $headerMs ms to headers and $processingMs ms processing per commit',
  async ({ headerMs, processingMs }) => {
    vi.useFakeTimers();
    // Native AbortSignal.timeout does not use the mocked JS clock.
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
      const controller = new AbortController();
      setTimeout(
        () => controller.abort(new DOMException('Timed out', 'TimeoutError')),
        milliseconds,
      );
      return controller.signal;
    });
    let readSignal: AbortSignal | undefined;
    const writer = await acquireDurableTransport({
      stores: {
        open: async () => ({
          storeId: 'store',
          writerToken: 'writer',
          writerExpiresAt: new Date(Date.now() + 30_000).toISOString(),
        }),
        renew: async () => ({
          writerExpiresAt: new Date(Date.now() + 30_000).toISOString(),
        }),
        read: async (
          _store: string,
          _after: number,
          options: Parameters<RuntimeSessionsNamespace['read']>[2],
        ) => {
          readSignal = options.signal;
          if (headerMs)
            await new Promise<void>((resolve) => {
              setTimeout(resolve, headerMs);
            });
          options.signal?.throwIfAborted();
          return {
            headSeq: 3,
            items: (async function* () {
              for (let seq = 1; seq <= 3; seq++) {
                await new Promise<void>((resolve) => {
                  setTimeout(resolve, 4_000);
                });
                options.signal?.throwIfAborted();
                yield { seq, writes: [] };
              }
            })(),
          };
        },
        release: async () => {},
      } as unknown as RuntimeSessionsNamespace,
      claimed,
      signal: new AbortController().signal,
    });
    try {
      const replay = (async () => {
        const page = await writer.transport.read(0, BACKGROUND_CONTEXT);
        const received: number[] = [];
        for await (const commit of page.items) {
          received.push(commit.seq);
          if (processingMs)
            await new Promise<void>((resolve) => {
              setTimeout(resolve, processingMs);
            });
        }
        return received;
      })().then(
        (received) => ({ received }),
        (error: unknown) => ({ error }),
      );
      await vi.advanceTimersByTimeAsync(headerMs + 12_000 + 3 * processingMs);
      expect(await replay).toEqual({ received: [1, 2, 3] });
      expect(writer.signal.aborted).toBe(false);
      // Completing the page must dispose its idle timer.
      await vi.advanceTimersByTimeAsync(10_000);
      expect(readSignal?.aborted).toBe(false);
    } finally {
      await writer.transport.close(BACKGROUND_CONTEXT);
    }
  },
);

it.each([
  'header timeout',
  'idle timeout',
  'cancellation',
  'context cancellation',
  'lease expiry',
] as const)('still fences a replay on %s', async (failure) => {
  vi.useFakeTimers();
  const cancellation = new AbortController();
  const context =
    failure === 'context cancellation'
      ? withAbortSignal(cancellation.signal, BACKGROUND_CONTEXT)
      : BACKGROUND_CONTEXT;
  const untilAborted = (signal?: AbortSignal) =>
    new Promise<void>((_resolve, reject) => {
      signal?.throwIfAborted();
      signal?.addEventListener('abort', () => reject(signal.reason), {
        once: true,
      });
    });
  const writer = await acquireDurableTransport({
    stores: {
      open: async () => ({
        storeId: 'store',
        writerToken: 'writer',
        writerExpiresAt: new Date(
          Date.now() + (failure === 'lease expiry' ? 8_000 : 30_000),
        ).toISOString(),
      }),
      renew: async () => {
        if (failure === 'lease expiry') throw new NetworkError('offline');
        return {
          writerExpiresAt: new Date(Date.now() + 30_000).toISOString(),
        };
      },
      read: async (
        _store: string,
        _after: number,
        options: Parameters<RuntimeSessionsNamespace['read']>[2],
      ) => {
        if (failure === 'header timeout') await untilAborted(options.signal);
        return {
          headSeq: 2,
          items: (async function* () {
            yield { seq: 1, writes: [] };
            await untilAborted(options.signal);
          })(),
        };
      },
      release: async () => {},
    } as unknown as RuntimeSessionsNamespace,
    claimed,
    signal:
      failure === 'context cancellation'
        ? new AbortController().signal
        : cancellation.signal,
  });
  try {
    const replay = (async () => {
      const page = await writer.transport.read(0, context);
      for await (const _ of page.items) {
        /* consume */
      }
    })().catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    if (failure === 'cancellation' || failure === 'context cancellation')
      cancellation.abort(new Error('cancelled'));
    else {
      const wait = failure === 'lease expiry' ? 8_000 : 10_000;
      await vi.advanceTimersByTimeAsync(wait - 1);
      expect(writer.signal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
    }
    expect(await replay).toBeInstanceOf(TaskExecutionInterrupted);
    expect(writer.signal.aborted).toBe(true);
    expect(() => writer.check()).toThrow();
  } finally {
    await writer.transport.close(BACKGROUND_CONTEXT);
  }
});
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
it('keeps the writer through a transient renewal failure within the lease', async () => {
  vi.useFakeTimers();
  const renew = vi
    .fn()
    .mockRejectedValueOnce(new NetworkError('fetch failed'))
    .mockRejectedValueOnce(
      new MoltNetError('Bad Gateway', { code: 'UNKNOWN', statusCode: 502 }),
    )
    .mockImplementation(async () => ({
      writerExpiresAt: new Date(Date.now() + 30_000).toISOString(),
    }));
  const writer = await acquireDurableTransport({
    stores: {
      open: async () => ({
        storeId: 'store',
        writerToken: 'writer',
        writerExpiresAt: new Date(Date.now() + 30_000).toISOString(),
      }),
      renew,
      release: async () => {},
    } as unknown as RuntimeSessionsNamespace,
    claimed,
    signal: new AbortController().signal,
  });
  try {
    await vi.advanceTimersByTimeAsync(10_000);
    expect(renew).toHaveBeenCalledTimes(2);
    expect(writer.signal.aborted).toBe(false);
    writer.check();

    await vi.advanceTimersByTimeAsync(5_000);
    expect(renew).toHaveBeenCalledTimes(3);
    // The confirmed renewal moved the deadline past the original lease.
    await vi.advanceTimersByTimeAsync(20_000);
    expect(writer.signal.aborted).toBe(false);
  } finally {
    await writer.transport.close(BACKGROUND_CONTEXT);
  }
});

it('expires with the last transient renewal error when the API never recovers', async () => {
  vi.useFakeTimers();
  const outage = new MoltNetError('Service Unavailable', {
    code: 'UNKNOWN',
    statusCode: 503,
  });
  const writer = await acquireDurableTransport({
    stores: {
      open: async () => ({
        storeId: 'store',
        writerToken: 'writer',
        writerExpiresAt: new Date(Date.now() + 30_000).toISOString(),
      }),
      renew: async () => {
        throw outage;
      },
      release: async () => {},
    } as unknown as RuntimeSessionsNamespace,
    claimed,
    signal: new AbortController().signal,
  });
  try {
    await vi.advanceTimersByTimeAsync(29_999);
    expect(writer.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(writer.signal.aborted).toBe(true);
    const reason = writer.signal.reason as Error;
    expect(reason).toBeInstanceOf(TaskExecutionInterrupted);
    expect(reason.message).toContain('expiry (store store)');
    expect((reason.cause as Error).cause).toBe(outage);
  } finally {
    await writer.transport.close(BACKGROUND_CONTEXT);
  }
});

it('stops progress immediately when renewal reports a stale writer', async () => {
  vi.useFakeTimers();
  const stale = new MoltNetError('Runtime store writer is stale', {
    code: 'conflict',
    statusCode: 409,
  });
  const writer = await acquireDurableTransport({
    stores: {
      open: async () => ({
        storeId: 'store',
        writerToken: 'writer',
        writerExpiresAt: new Date(Date.now() + 30_000).toISOString(),
      }),
      renew: async () => {
        throw stale;
      },
      release: async () => {},
    } as unknown as RuntimeSessionsNamespace,
    claimed,
    signal: new AbortController().signal,
  });
  try {
    await vi.advanceTimersByTimeAsync(5_000);
    expect(writer.signal.aborted).toBe(true);
    expect(writer.signal.reason).toMatchObject({
      message: expect.stringContaining('renew (store store)'),
      cause: stale,
    });
  } finally {
    await writer.transport.close(BACKGROUND_CONTEXT);
  }
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
