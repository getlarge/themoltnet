import type { Context } from '@earendil-works/chord';
import {
  type ClaimedTask,
  TaskExecutionInterrupted,
} from '@themoltnet/agent-runtime';
import type { RuntimeStoresNamespace } from '@themoltnet/sdk';

import type {
  DurableStoreTransport,
  RuntimeCommit,
} from './durable-storage.js';

/** One process owns this writer. Any renewal failure stops model/tool work. */
export async function acquireDurableTransport(input: {
  stores: RuntimeStoresNamespace;
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
  const request = (context?: Context) => ({
    teamId,
    signal: AbortSignal.any([
      signal,
      AbortSignal.timeout(10_000),
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
  let deadline = Date.parse(handle.writerExpiresAt);
  let closed = false;
  let renewal: Promise<void> | undefined;
  const fail = (error: unknown) => {
    lost.abort(
      new TaskExecutionInterrupted(
        'Durable writer lost; resume this attempt after its writer lease expires',
        { cause: error },
      ),
    );
  };
  const check = () => {
    if (Date.now() >= deadline) fail(new Error('Writer lease expired'));
    signal.throwIfAborted();
    if (closed) throw new Error('Durable writer closed');
  };
  const timer = setInterval(() => {
    if (closed || signal.aborted || renewal) return;
    renewal = (async () => {
      check();
      const renewed = await stores.renew(handle.storeId, writer, request());
      deadline = Date.parse(renewed.writerExpiresAt);
    })()
      .catch(fail)
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
          fail(error);
          throw lost.signal.reason;
        });
      return { ...page, items: page.items as unknown as RuntimeCommit[] };
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
            fail(error);
            throw lost.signal.reason;
          })
      ).id;
    },
    async close() {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      await renewal;
      // Closing must work after caller cancellation; expiry fences failed releases.
      await stores
        .release(handle.storeId, writer, {
          teamId,
          signal: AbortSignal.timeout(5_000),
        })
        .catch(() => undefined);
    },
    onUncertainCommit: fail,
  };
  return {
    transport,
    signal,
    check,
  };
}
