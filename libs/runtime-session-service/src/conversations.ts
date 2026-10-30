import { createHash } from 'node:crypto';

import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import {
  type ConversationId,
  type ConversationRecord,
  type DocumentAddress,
  type EntryId,
  MemoryStorage,
  type Seq,
  type StorageWrite,
} from '@earendil-works/pi-durable';
import type { RuntimeStoreRepository, TaskRepository } from '@moltnet/database';
import type {
  ConversationList,
  ConversationMessage,
  ConversationSnapshot,
} from '@moltnet/runtime-profiles';
import { type Span, SpanStatusCode, trace } from '@opentelemetry/api';

import { createConversationProjectionReader } from './conversation-projection.js';
import { createProblem } from './problems.js';
import type { RuntimeSessionSubject } from './runtime-sessions.js';
import type { createRuntimeStoreService } from './runtime-stores.js';

type Stores = ReturnType<typeof createRuntimeStoreService>;
type Attempt = RuntimeSessionSubject & {
  teamId: string;
  taskId: string;
  attemptN: number;
};
const context = BACKGROUND_CONTEXT;
const MAX_REPLAY_BYTES = 64 * 1024 * 1024;
const MAX_CONVERSATIONS = 1024;
const MAX_READERS = 16;
const MAX_TOTAL_REPLAY_BYTES = 128 * 1024 * 1024;
const IDLE_TTL_MS = 30_000;
const tracer = trace.getTracer('@moltnet/runtime-session-service');
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/**
 * Why a refresh stopped early, if it did: `deadline` for a timeout, `caller`
 * for a disconnect or shutdown. Undefined for a real failure, even one that
 * races an abort, so it is still recorded as an error.
 */
function abortKind(
  error: unknown,
  signal: AbortSignal | undefined,
): 'deadline' | 'caller' | undefined {
  if (!signal?.aborted) return undefined;
  const isAbort =
    error === signal.reason ||
    (error instanceof Error &&
      (error.name === 'AbortError' || error.name === 'TimeoutError'));
  if (!isAbort) return undefined;
  return signal.reason instanceof Error && signal.reason.name === 'TimeoutError'
    ? 'deadline'
    : 'caller';
}

function recordFailure(span: Span, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  span.recordException(error instanceof Error ? error : new Error(message));
  span.setStatus({ code: SpanStatusCode.ERROR, message });
}

/** An isolated read replica. Only Pi's public Storage methods run; no Harness, scheduler, models or writer lease. */
export function createConversationService(deps: {
  stores: Stores;
  repository: RuntimeStoreRepository;
  tasks: Pick<TaskRepository, 'findAttempt'>;
  now?: () => number;
  /** Enable the persistent read model; replay remains a compatibility oracle. */
  projection?: boolean;
}) {
  type Reader = ReturnType<typeof createReader>;
  const readers = new Set<Reader>();
  const idle = new Map<string, { reader: Reader; timer: NodeJS.Timeout }>();
  let totalBytes = 0;
  let stopped = false;

  async function dispose(reader: Reader) {
    if (!readers.delete(reader)) return;
    totalBytes -= reader.bytes;
    await reader.close();
  }
  async function evictOldest() {
    const entry = idle.entries().next().value;
    if (!entry) return false;
    const [key, cached] = entry;
    idle.delete(key);
    clearTimeout(cached.timer);
    await dispose(cached.reader);
    return true;
  }
  function createReader(input: Attempt) {
    const projection = deps.projection
      ? createConversationProjectionReader(deps.repository)
      : undefined;
    const storage = projection ?? new MemoryStorage();
    let seq = 0;
    let bytes = 0;
    let storeId: string | undefined;
    let firstSeq = 0;
    let root: ConversationId | undefined;
    let status = 'unknown';
    let writerActive = false;
    const created = new Map<number, number>();
    const parents = new Map<number, number | undefined>();
    let conversations: ConversationRecord[] = [];
    let closed = false;

    // Persisted commits are untrusted JSON. Pi's ancestry walks assume a valid
    // graph and are synchronous, so cancellation cannot stop a cycle there.
    function validateConversations(writes: Record<string, unknown>[]) {
      let changed = false;
      for (const write of writes) {
        if (write.type !== 'conversation') continue;
        const value = record(write.value);
        const id = value.id;
        const parent = record(value.parent);
        if (
          typeof id !== 'number' ||
          !Number.isSafeInteger(id) ||
          id < 1 ||
          parents.has(id) ||
          (value.parent !== undefined &&
            (typeof parent.conversationId !== 'number' ||
              !Number.isSafeInteger(parent.conversationId) ||
              parent.conversationId < 1 ||
              typeof parent.at !== 'number' ||
              !Number.isSafeInteger(parent.at) ||
              parent.at < 0))
        )
          throw createProblem(
            'service-unavailable',
            'Invalid conversation ancestry',
          );
        parents.set(id, parent.conversationId as number | undefined);
        changed = true;
        // Also bounds the maximum depth of every native ancestry traversal.
        if (parents.size > MAX_CONVERSATIONS)
          throw createProblem('service-unavailable', 'Too many conversations');
      }
      if (!changed) return;
      const checked = new Set<number>();
      for (const id of parents.keys()) {
        const path = new Set<number>();
        let current: number | undefined = id;
        while (current !== undefined && !checked.has(current)) {
          if (path.has(current) || !parents.has(current))
            throw createProblem(
              'service-unavailable',
              'Invalid conversation ancestry',
            );
          path.add(current);
          current = parents.get(current);
        }
        for (const ancestor of path) checked.add(ancestor);
      }
    }
    async function doc(address: DocumentAddress) {
      const entry = await storage.findDocument(address, 'current', context);
      return entry
        ? (await storage.document(entry.id, 'current', context))?.value
        : undefined;
    }
    // One span per refresh: cold vs incremental replay, and how its time splits
    // between waiting on reads and applying commits. Counters are set even when
    // the refresh fails, so a failed cold read still shows how far it got.
    function refresh(signal?: AbortSignal) {
      return tracer.startActiveSpan(
        'moltnet.conversation.refresh',
        {
          attributes: {
            'moltnet.task.id': input.taskId,
            'moltnet.task.attempt_n': input.attemptN,
          },
        },
        async (span) => {
          try {
            const result = await replay(span, signal);
            span.setStatus({ code: SpanStatusCode.OK });
            return result;
          } catch (error) {
            const aborted = abortKind(error, signal);
            if (aborted)
              span.setAttribute('moltnet.conversation.aborted_by', aborted);
            // A client disconnect or shutdown is not a read failure; a
            // deadline is the slow read this span exists to expose.
            if (aborted !== 'caller') recordFailure(span, error);
            throw error;
          } finally {
            span.end();
          }
        },
      );
    }
    async function replay(span: Span, signal?: AbortSignal) {
      signal?.throwIfAborted();
      span.setAttribute('moltnet.conversation.cold', seq === 0);
      if (closed) throw new Error('Conversation reader is closed');
      const attached = await deps.stores.findAttempt(input);
      if (!attached) {
        if (storeId) throw createProblem('not-found');
        return false;
      }
      if (storeId && attached.storeId !== storeId)
        throw createProblem('conflict', 'Attempt store changed');
      storeId = attached.storeId;
      span.setAttribute('moltnet.conversation.store_id', storeId);
      const attempt = await deps.tasks.findAttempt(
        input.taskId,
        input.attemptN,
      );
      if (!attempt) throw createProblem('not-found');
      status = attempt.status;
      const bounds = await deps.repository.attemptBounds(
        storeId,
        input.taskId,
        input.attemptN,
      );
      firstSeq = bounds.firstSeq;
      span.setAttributes({
        'moltnet.conversation.from_seq': seq,
        'moltnet.conversation.target_seq': bounds.lastSeq,
        'moltnet.conversation.first_seq': bounds.firstSeq,
      });
      if (projection) {
        await deps.stores.ensureConversationProjection({
          ...input,
          storeId,
          throughSeq: bounds.lastSeq,
          signal,
        });
        const rows = await projection.at(storeId, bounds.lastSeq);
        // Validate the complete, bounded conversation graph before ancestry walks.
        parents.clear();
        created.clear();
        validateConversations(
          rows.map((row) => ({ type: 'conversation', value: row.value })),
        );
        for (const row of rows) created.set(row.id, row.seq);
        seq = bounds.lastSeq;
        span.setAttribute('moltnet.conversation.read_model', true);
      } else {
        // Timed from the first page read, so every page counts the same way.
        const replayStart = performance.now();
        // Every refresh reauthorizes *all* attempts sharing the store, even if its head did not move.
        let page = await deps.stores.read({
          ...input,
          storeId,
          afterSeq: seq,
          signal,
          throughSeq: bounds.lastSeq,
          limit: 100,
        });
        if (bounds.lastSeq < seq)
          throw createProblem('conflict', 'Conversation history changed');
        const replayedFrom = seq;
        const bytesBefore = bytes;
        let applyMs = 0;
        let pages = 0;
        try {
          while (seq < bounds.lastSeq) {
            pages++;
            const previous = seq;
            for await (const commit of page.items) {
              signal?.throwIfAborted();
              if (commit.seq !== seq + 1)
                throw createProblem(
                  'service-unavailable',
                  'Incomplete conversation history',
                );
              const size = Buffer.byteLength(JSON.stringify(commit.writes));
              if (bytes + size > MAX_REPLAY_BYTES)
                throw createProblem(
                  'service-unavailable',
                  'Conversation replay exceeds the supported size',
                );
              while (totalBytes + size > MAX_TOTAL_REPLAY_BYTES) {
                if (!(await evictOldest()))
                  throw createProblem(
                    'service-unavailable',
                    'Conversation reader capacity reached',
                  );
              }
              bytes += size;
              totalBytes += size;
              const applyStart = performance.now();
              validateConversations(commit.writes);
              (storage as MemoryStorage)
                .prepareCommit(
                  commit.writes as unknown as StorageWrite[],
                  commit.seq as Seq,
                )
                .apply();
              for (const write of commit.writes) {
                if (write.type === 'conversation')
                  created.set(Number(record(write.value).id), commit.seq);
              }
              applyMs += performance.now() - applyStart;
              seq = commit.seq;
            }
            if (seq === previous)
              throw createProblem(
                'service-unavailable',
                'Incomplete conversation history',
              );
            if (seq < bounds.lastSeq) {
              page = await deps.stores.read({
                ...input,
                storeId,
                afterSeq: seq,
                signal,
                throughSeq: bounds.lastSeq,
                limit: 100,
              });
            }
          }
        } finally {
          const loopMs = performance.now() - replayStart;
          span.setAttributes({
            'moltnet.conversation.commits_replayed': seq - replayedFrom,
            'moltnet.conversation.replay_bytes': bytes - bytesBefore,
            'moltnet.conversation.pages': pages,
            // read_wait_ms is the replay loop's time minus apply_ms.
            'moltnet.conversation.read_wait_ms': Math.round(loopMs - applyMs),
            'moltnet.conversation.apply_ms': Math.round(applyMs),
          });
        }
      }
      const store = await deps.repository.get(input.teamId, storeId);
      writerActive =
        !!store &&
        store.writerTaskId === input.taskId &&
        store.writerAttemptN === input.attemptN &&
        !!store.writerExpiresAt &&
        store.writerExpiresAt.getTime() > (deps.now ?? Date.now)() &&
        ['claimed', 'running'].includes(status);
      const state = await doc({
        kind: 'moltnet.attempt',
        scope: { kind: 'session' },
        key: `${input.taskId}/${input.attemptN}`,
      });
      root =
        typeof state?.conversationId === 'number'
          ? (state.conversationId as ConversationId)
          : undefined;
      const all = await storage.scanConversations(
        {},
        MAX_CONVERSATIONS,
        undefined,
        context,
      );
      if (all.next)
        throw createProblem('service-unavailable', 'Too many conversations');
      const allowed = new Set<number>(root === undefined ? [] : [root]);
      let expanded = true;
      while (expanded) {
        expanded = false;
        for (const conversation of all.items) {
          if (
            conversation.owner &&
            allowed.has(conversation.owner.conversationId) &&
            (created.get(conversation.id) ?? 0) >= firstSeq &&
            !allowed.has(conversation.id)
          ) {
            allowed.add(conversation.id);
            expanded = true;
          }
        }
      }
      conversations = all.items.filter((c) => allowed.has(c.id));
      return true;
    }
    return {
      get bytes() {
        return bytes;
      },
      refresh,
      list(): ConversationList {
        return {
          items: conversations.map((c) => ({
            conversationId: String(c.id),
            parentConversationId: c.owner
              ? String(c.owner.conversationId)
              : null,
            kind: c.id === root ? 'main' : 'subagent',
          })),
        };
      },
      async snapshot(
        conversationId: string,
        query: { beforeEntryId?: string; limit?: number } = {},
      ): Promise<ConversationSnapshot> {
        const id = Number(conversationId) as ConversationId;
        if (
          !Number.isSafeInteger(id) ||
          !conversations.some((c) => c.id === id)
        )
          throw createProblem('not-found');
        const before =
          query.beforeEntryId === undefined
            ? undefined
            : Number(query.beforeEntryId);
        if (
          before !== undefined &&
          (!Number.isSafeInteger(before) || before < 1)
        )
          throw createProblem('validation-failed', 'Invalid entry cursor');
        const page = await storage.scanEntries(
          {
            conversationId: id,
            ...(before === undefined
              ? {}
              : { maxEntryId: (before - 1) as EntryId }),
          },
          query.limit ?? 100,
          undefined,
          context,
        );
        const messages: ConversationMessage[] = [];
        for (const entry of [...page.items].reverse()) {
          const stored = await storage.entry(entry.id, context);
          for (const [index, message] of (entry.model ?? []).entries()) {
            const value = record(message);
            messages.push({
              id: `${entry.id}/${index}`,
              entryId: String(entry.id),
              entryKind: entry.kind,
              inherited: (stored?.commitSeq ?? 0) < firstSeq,
              status:
                value.stopReason === 'aborted'
                  ? 'interrupted'
                  : value.stopReason === 'error'
                    ? 'failed'
                    : 'completed',
              message: value,
            });
          }
        }
        const live = record(
          await doc({
            kind: 'pi.live',
            scope: { kind: 'conversation', conversationId: id },
          }),
        );
        const partial = record(live.generation).message;
        if (before === undefined && partial)
          messages.push({
            id: `partial/${id}`,
            entryId: null,
            entryKind: 'pi.assistant',
            inherited: false,
            status: writerActive ? 'streaming' : 'interrupted',
            message: record(partial),
          });
        const cursor = createHash('sha256')
          .update(
            JSON.stringify([
              input.teamId,
              input.taskId,
              input.attemptN,
              storeId,
              id,
              seq,
              status,
              writerActive,
            ]),
          )
          .digest('base64url');
        return {
          conversationId,
          cursor,
          attemptStatus: status,
          messages,
          nextBeforeEntryId:
            page.next && page.items.length
              ? String(page.items[page.items.length - 1].id)
              : null,
          live,
        };
      },
      async close() {
        if (!closed) {
          closed = true;
          await storage.close(context);
        }
      },
    };
  }
  return {
    async open(input: Attempt, signal?: AbortSignal) {
      signal?.throwIfAborted();
      if (stopped) throw new Error('Conversation service is closed');
      // A reader has one owner at a time. Cache idle replicas by principal as
      // well as attempt; never share mutable state or authorization decisions.
      const key = JSON.stringify([
        input.teamId,
        input.taskId,
        input.attemptN,
        input.subjectNs,
        input.subjectId,
      ]);
      const cached = idle.get(key);
      if (cached) {
        idle.delete(key);
        clearTimeout(cached.timer);
      }
      while (!cached && readers.size >= MAX_READERS) {
        if (!(await evictOldest()))
          throw createProblem(
            'service-unavailable',
            'Conversation reader capacity reached',
          );
      }
      signal?.throwIfAborted();
      if (stopped) throw new Error('Conversation service is closed');
      const reader = cached?.reader ?? createReader(input);
      readers.add(reader);
      try {
        // Reauthorize on cache hits and unchanged heads, then replay only new commits.
        await reader.refresh(signal);
        signal?.throwIfAborted();
        if (stopped) throw new Error('Conversation service is closed');
      } catch (error) {
        await dispose(reader);
        throw error;
      }
      let released = false;
      let reusable = true;
      function assertOpen() {
        if (released || stopped)
          throw new Error('Conversation reader is closed');
      }
      return {
        async refresh(refreshSignal?: AbortSignal) {
          assertOpen();
          try {
            return await reader.refresh(refreshSignal);
          } catch (error) {
            reusable = false;
            throw error;
          }
        },
        list() {
          assertOpen();
          return reader.list();
        },
        async snapshot(...args: Parameters<Reader['snapshot']>) {
          assertOpen();
          return reader.snapshot(...args);
        },
        async close() {
          if (released) return;
          released = true;
          // Interrupted reads and overlapping requests never replace a healthy
          // idle replica. The cache is bounded by total replay bytes and count.
          if (stopped || !reusable || signal?.aborted || idle.has(key)) {
            await dispose(reader);
            return;
          }
          const timer = setTimeout(() => {
            idle.delete(key);
            void dispose(reader);
          }, IDLE_TTL_MS);
          timer.unref();
          idle.set(key, { reader, timer });
        },
      };
    },
    async close() {
      stopped = true;
      for (const cached of idle.values()) clearTimeout(cached.timer);
      idle.clear();
      await Promise.all([...readers].map(dispose));
    },
  };
}
