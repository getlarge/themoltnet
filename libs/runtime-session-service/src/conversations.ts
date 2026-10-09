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
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** An isolated read replica. Only Pi's public Storage methods run; no Harness, scheduler, models or writer lease. */
export function createConversationService(deps: {
  stores: Stores;
  repository: RuntimeStoreRepository;
  tasks: Pick<TaskRepository, 'findAttempt'>;
  now?: () => number;
}) {
  return {
    async open(input: Attempt) {
      const storage = new MemoryStorage();
      let seq = 0;
      let bytes = 0;
      let storeId: string | undefined;
      let firstSeq = 0;
      let root: ConversationId | undefined;
      let status = 'unknown';
      let writerActive = false;
      const created = new Map<number, number>();
      let conversations: ConversationRecord[] = [];
      let closed = false;

      async function doc(address: DocumentAddress) {
        const entry = await storage.findDocument(address, 'current', context);
        return entry
          ? (await storage.document(entry.id, 'current', context))?.value
          : undefined;
      }
      async function refresh(signal?: AbortSignal) {
        signal?.throwIfAborted();
        if (closed) throw new Error('Conversation reader is closed');
        const attached = await deps.stores.findAttempt(input);
        if (!attached) {
          if (storeId) throw createProblem('not-found');
          return false;
        }
        if (storeId && attached.storeId !== storeId)
          throw createProblem('conflict', 'Attempt store changed');
        storeId = attached.storeId;
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
        // Every refresh reauthorizes *all* attempts sharing the store, even if its head did not move.
        let page = await deps.stores.read({
          ...input,
          storeId,
          afterSeq: seq,
          throughSeq: bounds.lastSeq,
          limit: 100,
        });
        if (bounds.lastSeq < seq)
          throw createProblem('conflict', 'Conversation history changed');
        while (seq < bounds.lastSeq) {
          const previous = seq;
          for await (const commit of page.items) {
            signal?.throwIfAborted();
            if (commit.seq !== seq + 1)
              throw createProblem(
                'service-unavailable',
                'Incomplete conversation history',
              );
            bytes += Buffer.byteLength(JSON.stringify(commit.writes));
            if (bytes > MAX_REPLAY_BYTES)
              throw createProblem(
                'service-unavailable',
                'Conversation replay exceeds the supported size',
              );
            storage
              .prepareCommit(
                commit.writes as unknown as StorageWrite[],
                commit.seq as Seq,
              )
              .apply();
            for (const write of commit.writes) {
              if (write.type === 'conversation')
                created.set(Number(record(write.value).id), commit.seq);
            }
            seq = commit.seq;
          }
          if (seq === previous)
            throw createProblem(
              'service-unavailable',
              'Incomplete conversation history',
            );
          if (seq < bounds.lastSeq)
            page = await deps.stores.read({
              ...input,
              storeId,
              afterSeq: seq,
              throughSeq: bounds.lastSeq,
              limit: 100,
            });
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
      const reader = {
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
      try {
        await refresh();
        return reader;
      } catch (error) {
        await reader.close();
        throw error;
      }
    },
  };
}
