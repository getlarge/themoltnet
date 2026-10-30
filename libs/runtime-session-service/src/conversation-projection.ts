import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import {
  type ConversationRecord,
  type DocumentAddress,
  type DocumentId,
  type EntryRecord,
  MemoryStorage,
  type Seq,
  type StorageWrite,
  type StoredDocument,
} from '@earendil-works/pi-durable';
import type { RuntimeStoreRepository } from '@moltnet/database';

import { timedRead } from './read-timing.js';

const context = BACKGROUND_CONTEXT;
type Row = NonNullable<
  Awaited<ReturnType<RuntimeStoreRepository['conversationRecord']>>
>;
type Insert = Omit<Row, 'storeId' | 'seq'>;
type Document = StoredDocument & { retired?: boolean };
const object = (value: unknown) => value as Record<string, unknown>;
export const documentAddress = (a: DocumentAddress) =>
  JSON.stringify([
    a.kind,
    a.scope.kind,
    a.scope.kind === 'conversation'
      ? a.scope.conversationId
      : a.scope.kind === 'task'
        ? a.scope.taskId
        : null,
    a.key ?? null,
  ]);
const relevant = (kind: string) =>
  kind === 'moltnet.attempt' || kind === 'pi.live';

/** Called under the store's write lock, in the same transaction as publication.
 * Pi itself applies document deltas; this projection does not implement Chord.
 * Versioned rows preserve the view at a completed attempt's last commit.
 */
export async function projectConversationCommit(
  repo: RuntimeStoreRepository,
  storeId: string,
  seq: number,
  writes: StorageWrite[],
) {
  const rows: Insert[] = [];
  const documents = new Map<number, StorageWrite[]>();
  for (const write of writes) {
    if (write.type === 'conversation' || write.type === 'entry') {
      rows.push({
        type: write.type,
        id: write.value.id,
        conversationId:
          write.type === 'entry' ? write.value.conversationId : null,
        address: null,
        value: object(write.value),
      });
    } else if (
      typeof write.type === 'string' &&
      write.type.startsWith('document.')
    ) {
      const id =
        'record' in write
          ? write.record.id
          : 'id' in write
            ? write.id
            : undefined;
      if (id !== undefined)
        documents.set(id, [...(documents.get(id) ?? []), write]);
    }
  }
  const entryIds = rows
    .filter((row) => row.type === 'entry')
    .map((row) => row.id);
  if (entryIds.length) {
    const previous = await timedRead('database.projection', () =>
      repo.conversationRecord(storeId, 'entry-boundary', 0, seq - 1),
    );
    // IDs can be allocated before they are committed. Keep a cumulative ceiling,
    // rather than assuming that commit order and ID order are identical.
    rows.push({
      type: 'entry-boundary',
      id: 0,
      conversationId: null,
      address: null,
      value: {
        maxEntryId: Math.max(
          Number(previous?.value.maxEntryId ?? 0),
          ...entryIds,
        ),
      },
    });
  }
  for (const [id, changes] of documents) {
    const creation = changes.find(
      (w) => w.type === 'document.create' || w.type === 'document.copy',
    );
    const previous = await timedRead('database.projection', () =>
      repo.conversationRecord(storeId, 'document', id, seq - 1),
    );
    if (
      creation && 'record' in creation
        ? !relevant(creation.record.kind)
        : !previous
    )
      continue;
    const storage = new MemoryStorage();
    try {
      if (previous) {
        const old = previous.value as unknown as Document;
        if (old.retired) throw new Error('Conversation document is retired');
        storage
          .prepareCommit(
            [
              {
                type: 'document.create',
                record: old.record,
                content: {
                  kind: 'base',
                  version: old.version,
                  value: old.value,
                },
              },
            ],
            (seq - 1) as Seq,
          )
          .apply();
      }
      const resolved: StorageWrite[] = [];
      for (const change of changes) {
        if (change.type !== 'document.copy') {
          resolved.push(change);
          continue;
        }
        if (documents.has(change.source.id))
          throw new Error('Copy source changes in the same commit');
        const source = await timedRead('database.projection', () =>
          repo.conversationRecord(
            storeId,
            'document',
            change.source.id,
            change.source.at === 'current' ? seq - 1 : change.source.at,
          ),
        );
        if (!source)
          throw new Error('Conversation document copy source missing');
        const doc = source.value as unknown as Document;
        if (doc.retired)
          throw new Error('Conversation document copy source retired');
        const copy = new MemoryStorage();
        try {
          copy
            .prepareCommit(
              [
                {
                  type: 'document.create',
                  record: doc.record,
                  content: {
                    kind: 'base',
                    version: doc.version,
                    value: doc.value,
                  },
                },
              ],
              source.seq as Seq,
            )
            .apply();
          // Resolve through Pi to enforce kind/scope/history/fork compatibility.
          resolved.push(...copy.prepareCommit([change], seq as Seq).writes);
        } finally {
          await copy.close(context);
        }
      }
      storage.prepareCommit(resolved, seq as Seq).apply();
      const current = await storage.document(
        id as DocumentId,
        'current',
        context,
      );
      const record =
        current?.record ??
        (creation && 'record' in creation
          ? creation.record
          : (previous.value as unknown as Document).record);
      rows.push({
        type: 'document',
        id,
        conversationId:
          record.scope.kind === 'conversation'
            ? record.scope.conversationId
            : null,
        address: documentAddress(record),
        value: object(current ?? { record, retired: true }),
      });
    } finally {
      await storage.close(context);
    }
  }
  await repo.saveConversationRecords(storeId, seq, rows);
}

/** Query-sized reads; no process-local replay cache or object downloads. */
export function createConversationProjectionReader(
  repo: RuntimeStoreRepository,
) {
  let storeId = '';
  let seq = 0;
  let maxEntryId = 0;
  let conversations: Row[] = [];
  const pageEntries = new Map<number, Row>();
  const foundDocuments = new Map<number, Document>();
  return {
    async at(store: string, throughSeq: number) {
      storeId = store;
      seq = throughSeq;
      pageEntries.clear();
      foundDocuments.clear();
      const boundary = await timedRead('database.projection', () =>
        repo.conversationRecord(storeId, 'entry-boundary', 0, seq),
      );
      maxEntryId = Number(boundary?.value.maxEntryId ?? 0);
      conversations = await timedRead('database.projection', () =>
        repo.conversationList(storeId, seq),
      );
      return conversations;
    },
    async findDocument(address: DocumentAddress) {
      const row = await timedRead('database.projection', () =>
        repo.conversationDocument(storeId, documentAddress(address), seq),
      );
      const doc = row?.value as unknown as Document | undefined;
      if (doc && !doc.retired) foundDocuments.set(doc.record.id, doc);
      return doc && !doc.retired ? doc.record : undefined;
    },
    async document(id: DocumentId) {
      const cached = foundDocuments.get(id);
      if (cached) return cached;
      const row = await timedRead('database.projection', () =>
        repo.conversationRecord(storeId, 'document', id, seq),
      );
      const doc = row?.value as unknown as Document | undefined;
      return doc && !doc.retired ? doc : undefined;
    },
    async scanConversations() {
      return {
        items: conversations.map(
          (row) => row.value as unknown as ConversationRecord,
        ),
        next: conversations.length > 1024 ? {} : undefined,
      };
    },
    async entry(id: number) {
      const row =
        pageEntries.get(id) ??
        (await timedRead('database.projection', () =>
          repo.conversationRecord(storeId, 'entry', id, seq),
        ));
      return row
        ? {
            entry: row.value as unknown as EntryRecord,
            commitSeq: row.seq as Seq,
          }
        : undefined;
    },
    async scanEntries(
      query: { conversationId: number; maxEntryId?: number },
      limit: number,
    ) {
      const items: EntryRecord[] = [];
      pageEntries.clear();
      let id: number | undefined = query.conversationId;
      let upper = Math.min(query.maxEntryId ?? maxEntryId, maxEntryId);
      const seen = new Set<number>();
      // Pi scans each fork segment newest first, then its parent through parent.at.
      while (id !== undefined && items.length <= limit) {
        if (seen.has(id)) throw new Error('Invalid conversation ancestry');
        seen.add(id);
        const conversation = conversations.find((row) => row.id === id)
          ?.value as unknown as ConversationRecord | undefined;
        if (!conversation) throw new Error('Missing conversation ancestor');
        const currentId = id;
        const rows = await timedRead('database.projection', () =>
          repo.conversationEntries(
            storeId,
            currentId,
            seq,
            upper,
            limit + 1 - items.length,
          ),
        );
        for (const row of rows) pageEntries.set(row.id, row);
        items.push(...rows.map((row) => row.value as unknown as EntryRecord));
        upper = Math.min(upper, conversation.parent?.at ?? upper);
        id = conversation.parent?.conversationId;
      }
      return {
        items: items.slice(0, limit),
        next: items.length > limit ? {} : undefined,
      };
    },
    async close() {},
  };
}
