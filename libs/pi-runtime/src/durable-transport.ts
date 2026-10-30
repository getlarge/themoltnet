import type { Context } from '@earendil-works/chord';
import {
  type ClaimedTask,
  TaskExecutionInterrupted,
} from '@themoltnet/agent-runtime';
import type { RuntimeSessionsNamespace } from '@themoltnet/sdk';

import type {
  DurableStoreTransport,
  RuntimeCommit,
} from './durable-storage.js';

/** One process owns this writer. Exhausted retries or expiry stop model/tool work. */
export async function acquireDurableTransport(input: {
  stores: RuntimeSessionsNamespace;
  claimed: ClaimedTask;
  signal: AbortSignal;
}): Promise<{
  transport: DurableStoreTransport;
  signal: AbortSignal;
  check(): void;
}> {
  const { stores, claimed } = input;
  const { leaseId, executorFingerprint } = claimed.claimAuthority ?? {};
  if (!leaseId || !executorFingerprint)
    throw new Error('Durable execution requires attested attempt authority');
  const authority = {
    taskId: claimed.task.id,
    attemptN: claimed.attemptN,
    leaseId,
    executorFingerprint,
  };
  const teamId = claimed.task.teamId;
  const lost = new AbortController();
  const signal = AbortSignal.any([input.signal, lost.signal]);
  let deadline = Number.POSITIVE_INFINITY;
  const request = (context?: Context) => ({
    teamId,
    signal: AbortSignal.any([
      signal,
      AbortSignal.timeout(Math.max(0, Math.min(10_000, deadline - Date.now()))),
      ...(context?.abortSignal ? [context.abortSignal] : []),
    ]),
  });
  const handle = await stores
    .open(authority, request())
    .catch((cause: unknown) => {
      throw new TaskExecutionInterrupted(
        'Unable to acquire Durable writer; no attempt finalization was attempted',
        { cause },
      );
    });
  const writer = { ...authority, writerToken: handle.writerToken };
  deadline = Date.parse(handle.writerExpiresAt);
  let closed = false;
  let renewal: Promise<void> | undefined;
  const fail = (
    operation: 'renew' | 'read' | 'read_body' | 'mint_id' | 'commit' | 'expiry',
    error: unknown,
  ) => {
    lost.abort(
      new TaskExecutionInterrupted(
        `Durable writer lost during ${operation} (store ${handle.storeId}); reconcile the attempt before resuming`,
        { cause: error },
      ),
    );
  };
  const check = () => {
    if (Date.now() >= deadline)
      fail('expiry', new Error('Writer lease expired'));
    signal.throwIfAborted();
    if (closed) throw new Error('Durable writer closed');
  };
  // Fence model/tool work even when no storage operation calls check(). Renewal
  // and its backoff must never let execution outlive the last confirmed lease.
  let expiry: ReturnType<typeof setTimeout>;
  const scheduleExpiry = () => {
    clearTimeout(expiry);
    expiry = setTimeout(
      () => fail('expiry', new Error('Writer lease expired')),
      Math.max(0, deadline - Date.now()),
    );
    expiry.unref();
  };
  scheduleExpiry();
  const timer = setInterval(() => {
    if (closed || signal.aborted || renewal) return;
    renewal = (async () => {
      check();
      const renewed = await stores.renew(handle.storeId, writer, request());
      if (closed) return;
      check();
      deadline = Date.parse(renewed.writerExpiresAt);
      scheduleExpiry();
    })()
      .catch((error: unknown) => fail('renew', error))
      .finally(() => {
        renewal = undefined;
      });
  }, 5_000);
  timer.unref();
  const transport: DurableStoreTransport = {
    async read(afterSeq, context) {
      check();
      const page = await stores
        .read(handle.storeId, afterSeq, request(context))
        .catch((error: unknown) => {
          fail('read', error);
          throw lost.signal.reason;
        });
      async function* items(): AsyncGenerator<RuntimeCommit> {
        try {
          for await (const commit of page.items) {
            check();
            yield commit as unknown as RuntimeCommit;
          }
        } catch (error) {
          fail('read_body', error);
          throw lost.signal.reason;
        }
      }
      return { headSeq: page.headSeq, items: items() };
    },
    async append(commit, context) {
      check();
      return stores.append(
        handle.storeId,
        {
          ...writer,
          ...commit,
          writes: commit.writes as unknown as Record<string, unknown>[],
        },
        request(context),
      );
    },
    async mintId() {
      check();
      return (
        await stores
          .mintId(handle.storeId, writer, request())
          .catch((error: unknown) => {
            fail('mint_id', error);
            throw lost.signal.reason;
          })
      ).id;
    },
    async close() {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      clearTimeout(expiry);
      await renewal;
      // Closing must work after caller cancellation; expiry fences failed releases.
      await stores
        .release(handle.storeId, writer, {
          teamId,
          signal: AbortSignal.timeout(5_000),
        })
        .catch(() => undefined);
    },
    onUncertainCommit: (error) => fail('commit', error),
  };
  return {
    transport,
    signal,
    check,
  };
}
