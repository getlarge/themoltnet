import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import {
  createSession,
  defineDocFamily,
  type DocumentCreate,
  type DocumentId,
  type EntryId,
  LiveDoc,
  MemoryStorage,
  type StorageWrite,
} from '@earendil-works/pi-durable';
import type { RuntimeStoreRepository } from '@moltnet/database';
import { describe, expect, it, vi } from 'vitest';

import {
  createConversationProjectionReader,
  projectConversationCommit,
} from '../src/conversation-projection.js';

type Row = NonNullable<
  Awaited<ReturnType<RuntimeStoreRepository['conversationRecord']>>
>;
function repository() {
  const rows: Row[] = [];
  let head = 0;
  const repo = {
    conversationRecord: async (
      store: string,
      type: string,
      id: number,
      seq: number,
    ) =>
      rows
        .filter(
          (r) =>
            r.storeId === store &&
            r.type === type &&
            r.id === id &&
            r.seq <= seq,
        )
        .sort((a, b) => b.seq - a.seq)[0],
    conversationDocument: async (store: string, address: string, seq: number) =>
      rows
        .filter(
          (r) => r.storeId === store && r.address === address && r.seq <= seq,
        )
        .sort((a, b) => b.seq - a.seq || b.id - a.id)[0],
    conversationList: async (store: string, seq: number) =>
      rows
        .filter(
          (r) =>
            r.storeId === store && r.type === 'conversation' && r.seq <= seq,
        )
        .sort((a, b) => a.id - b.id),
    conversationEntries: async (
      store: string,
      id: number,
      seq: number,
      max: number,
      limit: number,
    ) =>
      rows
        .filter(
          (r) =>
            r.storeId === store &&
            r.type === 'entry' &&
            r.conversationId === id &&
            r.seq <= seq &&
            r.id <= max,
        )
        .sort((a, b) => b.id - a.id)
        .slice(0, limit),
    saveConversationRecords: async (
      storeId: string,
      seq: number,
      records: Omit<Row, 'storeId' | 'seq'>[],
    ) => {
      rows.push(
        ...structuredClone(records).map((r) => ({ ...r, storeId, seq })),
      );
      head = seq;
    },
  } as unknown as RuntimeStoreRepository;
  return { repo, rows, head: () => head };
}
const Attempt = defineDocFamily({
  kind: 'moltnet.attempt',
  version: 1,
  scope: 'session',
  family: true,
  checkpointWhen: () => false,
  initial: (conversationId: number) => ({ conversationId }),
});

async function fixture() {
  const db = repository();
  class Writer extends MemoryStorage {
    override async commit(writes: readonly StorageWrite[]) {
      const seq = await super.commit(writes, context);
      await projectConversationCommit(db.repo, 'store', seq, [...writes]);
      return seq;
    }
  }
  const storage = new Writer();
  const session = createSession(storage);
  const reader = createConversationProjectionReader(db.repo);
  const root = (
    await session.commit(
      (tx) => tx.createConversation({ ownership: { kind: 'ownerless' } }),
      context,
    )
  ).id;
  await session.commit(async (tx) => {
    await tx.doc(Attempt, 'task/1', root);
  }, context);
  return { ...db, storage, session, reader, root };
}

describe('conversation projection conforms to Pi storage', () => {
  it('reuses idle payload reads and misses only at the same store and published sequence', async () => {
    const f = await fixture();
    const append = () =>
      f.session.commit(
        (tx) =>
          tx.appendEntry(f.root, {
            kind: 'pi.user',
            model: [{ role: 'user', content: 'message', timestamp: 1 }],
          }),
        context,
      );
    await append();
    const setLive = (text: string) =>
      f.session.commit(async (tx) => {
        const live = await tx.doc(LiveDoc, f.root);
        live.generation = {
          attempt: 1,
          message: {
            role: 'assistant',
            content: [{ type: 'text', text }],
          } as never,
        };
      }, context);
    await setLive('first');
    const address = {
      kind: 'pi.live',
      scope: { kind: 'conversation' as const, conversationId: f.root },
    };
    const missing = { ...address, key: 'missing' };
    const records = vi.spyOn(f.repo, 'conversationRecord');
    const lists = vi.spyOn(f.repo, 'conversationList');
    const documents = vi.spyOn(f.repo, 'conversationDocument');
    const entries = vi.spyOn(f.repo, 'conversationEntries');
    const read = async () => {
      await f.reader.at('store', f.head());
      const record = await f.reader.findDocument(address);
      const live = await f.reader.document(record!.id);
      expect(await f.reader.findDocument(missing)).toBeUndefined();
      expect(await f.reader.document(9999 as DocumentId)).toBeUndefined();
      const page = await f.reader.scanEntries({ conversationId: f.root }, 10);
      for (const entry of page.items)
        expect((await f.reader.entry(entry.id))?.entry).toEqual(entry);
      return { live, page };
    };
    const original = await read();
    for (const spy of [records, lists, documents, entries]) spy.mockClear();
    expect(await read()).toEqual(original);
    for (const spy of [records, lists, documents, entries])
      expect(spy).not.toHaveBeenCalled();

    await setLive('second');
    await append();
    for (const spy of [records, lists, documents, entries]) spy.mockClear();
    const updated = await read();
    expect(JSON.stringify(updated.live)).toContain('second');
    expect(updated.page.items).toHaveLength(2);
    for (const spy of [records, lists, documents, entries])
      expect(spy).toHaveBeenCalled();

    // A different store with the same sequence/IDs cannot reuse cached payloads.
    f.rows.push(
      ...structuredClone(f.rows).map((row) => ({
        ...row,
        storeId: 'other',
        value:
          row.type === 'entry'
            ? { ...row.value, kind: 'other-store' }
            : row.value,
      })),
    );
    for (const spy of [records, lists, documents, entries]) spy.mockClear();
    await f.reader.at('other', f.head());
    const other = await f.reader.scanEntries({ conversationId: f.root }, 10);
    expect(other.items.every((entry) => entry.kind === 'other-store')).toBe(
      true,
    );
    await f.reader.findDocument(missing);
    for (const spy of [records, lists, documents, entries])
      expect(spy).toHaveBeenCalled();
    await f.session.close(context);
  });

  it('retains only the latest page and its metadata when cursors and limits alternate', async () => {
    const f = await fixture();
    for (let i = 0; i < 5; i++)
      await f.session.commit(
        (tx) =>
          tx.appendEntry(f.root, {
            kind: 'pi.user',
            model: [{ role: 'user', content: String(i), timestamp: i }],
          }),
        context,
      );
    await f.reader.at('store', f.head());
    const entries = vi.spyOn(f.repo, 'conversationEntries');
    const records = vi.spyOn(f.repo, 'conversationRecord');
    const query = { conversationId: f.root };
    const first = await f.reader.scanEntries(query, 1);
    expect(await f.reader.scanEntries(query, 1)).toEqual(first);
    expect(entries).toHaveBeenCalledTimes(1);
    const before = first.items[0].id - 1;
    const second = await f.reader.scanEntries(
      { ...query, maxEntryId: before },
      1,
    );
    expect(second.items[0].id).toBeLessThan(first.items[0].id);
    expect((await f.reader.entry(second.items[0].id))?.entry).toEqual(
      second.items[0],
    );
    expect(records).not.toHaveBeenCalled();
    // A row from the evicted page must use the repository, not stale metadata.
    expect((await f.reader.entry(first.items[0].id))?.entry).toEqual(
      first.items[0],
    );
    expect(records).toHaveBeenCalledTimes(1);
    expect(await f.reader.scanEntries(query, 1)).toEqual(first);
    expect(entries).toHaveBeenCalledTimes(3);
    const wider = await f.reader.scanEntries(query, 3);
    expect(wider.items).toHaveLength(3);
    expect(entries).toHaveBeenCalledTimes(4);
    records.mockClear();
    for (const entry of wider.items)
      expect((await f.reader.entry(entry.id))?.entry).toEqual(entry);
    expect(records).not.toHaveBeenCalled();
    await f.session.close(context);
  });

  it('retries failed sequence loads and bounds document-address misses', async () => {
    const f = await fixture();
    const lists = vi
      .spyOn(f.repo, 'conversationList')
      .mockRejectedValueOnce(new Error('database unavailable'));
    await expect(f.reader.at('store', f.head())).rejects.toThrow(
      'database unavailable',
    );
    await f.reader.at('store', f.head());
    expect(lists).toHaveBeenCalledTimes(2);
    const documents = vi.spyOn(f.repo, 'conversationDocument');
    const address = (key: string) => ({
      kind: 'pi.live',
      scope: { kind: 'conversation' as const, conversationId: f.root },
      key,
    });
    for (let i = 0; i < 129; i++)
      await f.reader.findDocument(address(String(i)));
    await f.reader.findDocument(address('128'));
    expect(documents).toHaveBeenCalledTimes(129);
    await f.reader.findDocument(address('0'));
    expect(documents).toHaveBeenCalledTimes(130);
    await f.reader.close();
    await f.reader.at('store', f.head());
    expect(lists).toHaveBeenCalledTimes(3);
    await f.session.close(context);
  });
  it('pages immutable entries and preserves historical commit boundaries', async () => {
    const f = await fixture();
    for (let i = 0; i < 110; i++)
      await f.session.commit(
        (tx) =>
          tx.appendEntry(f.root, {
            kind: 'pi.user',
            model: [{ role: 'user', content: String(i), timestamp: i }],
          }),
        context,
      );
    const boundary = f.head();
    await f.session.commit(
      (tx) =>
        tx.appendEntry(f.root, {
          kind: 'pi.user',
          model: [{ role: 'user', content: 'later attempt', timestamp: 111 }],
        }),
      context,
    );
    await f.reader.at('store', boundary);
    const recordReads = vi.spyOn(f.repo, 'conversationRecord');
    let before: EntryId | undefined;
    const seen: number[] = [];
    for (let i = 0; i < 4; i++) {
      const query = { conversationId: f.root, maxEntryId: before };
      const actual = await f.reader.scanEntries(query, 30);
      // Exclude the newer attempt's entry from the native oracle too.
      const oracle = await f.storage.scanEntries(
        {
          ...query,
          maxEntryId:
            before ??
            (
              await f.storage.scanEntries(
                { conversationId: f.root },
                2,
                undefined,
                context,
              )
            ).items[1].id,
        },
        30,
        undefined,
        context,
      );
      expect(actual.items).toEqual(oracle.items);
      for (const entry of actual.items)
        expect((await f.reader.entry(entry.id))?.entry).toEqual(entry);
      expect(recordReads).not.toHaveBeenCalled();
      expect(Boolean(actual.next)).toBe(Boolean(oracle.next));
      seen.push(...actual.items.map((e) => e.id));
      before = (actual.items.at(-1)!.id - 1) as EntryId;
    }
    expect(new Set(seen).size).toBe(110);
    await f.session.close(context);
  });
  it('materializes live deltas, retains the prior attempt view, and retires documents', async () => {
    const f = await fixture();
    await f.session.commit(async (tx) => {
      const live = await tx.doc(LiveDoc, f.root);
      live.generation = {
        attempt: 1,
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'first' }],
        } as never,
      };
    }, context);
    const boundary = f.head();
    const address = {
      kind: 'pi.live',
      scope: { kind: 'conversation' as const, conversationId: f.root },
    };
    const record = await f.storage.findDocument(address, 'current', context);
    await f.session.commit(async (tx) => {
      const live = await tx.doc(LiveDoc, f.root);
      live.generation!.message!.content[0] = { type: 'text', text: 'second' };
    }, context);
    await f.reader.at('store', f.head());
    expect((await f.reader.document(record!.id))!.value).toEqual(
      (await f.storage.document(record!.id, 'current', context))!.value,
    );
    await f.reader.at('store', boundary);
    expect(
      JSON.stringify((await f.reader.document(record!.id))!.value),
    ).toContain('first');
    await f.storage.commit([{ type: 'document.retire', id: record!.id }]);
    await f.reader.at('store', f.head());
    expect(await f.reader.findDocument(address)).toBeUndefined();
    await f.session.close(context);
  });
  it('copies historical and current documents independently after the source advances', async () => {
    const f = await fixture();
    const children = await f.session.commit(
      (tx) =>
        Promise.all([
          tx.createConversation({ ownership: { kind: 'ownerless' } }),
          tx.createConversation({ ownership: { kind: 'ownerless' } }),
        ]),
      context,
    );
    const sourceId = await f.storage.mintId<DocumentId>();
    const record: DocumentCreate = {
      id: sourceId,
      kind: 'moltnet.attempt',
      scope: { kind: 'conversation', conversationId: f.root },
      history: 'rewindable',
      fork: 'asOf',
      key: 'source',
    };
    const createdAt = await f.storage.commit([
      {
        type: 'document.create',
        record,
        content: { kind: 'base', version: 2, value: { count: 1 } },
      },
    ]);
    await f.storage.commit([
      {
        type: 'document.change',
        id: sourceId,
        content: { kind: 'delta', version: 2, ops: [['s', ['count'], 2]] },
      },
    ]);
    const historicalId = await f.storage.mintId<DocumentId>();
    const currentId = await f.storage.mintId<DocumentId>();
    await f.storage.commit([
      {
        type: 'document.copy',
        record: {
          ...record,
          id: historicalId,
          scope: { kind: 'conversation', conversationId: children[0].id },
        },
        source: { id: sourceId, at: createdAt },
      },
      {
        type: 'document.copy',
        record: {
          ...record,
          id: currentId,
          scope: { kind: 'conversation', conversationId: children[1].id },
        },
        source: { id: sourceId, at: 'current' },
      },
    ]);
    const copyBoundary = f.head();
    await f.storage.commit([
      {
        type: 'document.change',
        id: sourceId,
        content: { kind: 'base', version: 2, value: { count: 3 } },
      },
    ]);
    for (const throughSeq of [copyBoundary, f.head()]) {
      await f.reader.at('store', throughSeq);
      for (const [id, count] of [
        [historicalId, 1],
        [currentId, 2],
      ] as const) {
        const actual = await f.reader.document(id);
        const expected = await f.storage.document(id, 'current', context);
        expect(actual).toEqual(expected);
        expect(actual?.value).toEqual({ count });
      }
    }
    await f.session.close(context);
  });
  it('bounds frozen pages by the cumulative ID ceiling even when IDs commit out of order', async () => {
    const f = await fixture();
    const ids = await Promise.all(
      Array.from({ length: 4 }, () => f.storage.mintId<EntryId>()),
    );
    const append = (id: EntryId) =>
      f.storage.commit([
        {
          type: 'entry',
          value: { id, conversationId: f.root, kind: 'pi.user', model: [] },
        },
      ]);
    await append(ids[2]);
    await append(ids[0]);
    const boundary = f.head();
    await append(ids[3]);
    // A later commit can consume a previously allocated lower ID as well.
    await append(ids[1]);
    await f.reader.at('store', boundary);
    const reads = vi.spyOn(f.repo, 'conversationEntries');
    expect(
      (await f.reader.scanEntries({ conversationId: f.root }, 10)).items.map(
        (e) => e.id,
      ),
    ).toEqual([ids[2], ids[0]]);
    expect(reads).toHaveBeenLastCalledWith(
      'store',
      f.root,
      boundary,
      ids[2],
      11,
    );
    await f.reader.at('store', f.head());
    expect(
      (await f.reader.scanEntries({ conversationId: f.root }, 10)).items.map(
        (e) => e.id,
      ),
    ).toEqual([...ids].reverse());
    await f.session.close(context);
  });
  it('returns the same fork ancestry and pagination as Pi', async () => {
    const f = await fixture();
    const first = await f.session.commit(
      (tx) =>
        tx.appendEntry(f.root, {
          kind: 'pi.user',
          model: [{ role: 'user', content: 'inherited', timestamp: 1 }],
        }),
      context,
    );
    await f.session.commit(
      (tx) =>
        tx.appendEntry(f.root, {
          kind: 'pi.user',
          model: [{ role: 'user', content: 'excluded', timestamp: 2 }],
        }),
      context,
    );
    const fork = await f.session.commit(
      (tx) =>
        tx.forkConversation(f.root, first.id, {
          ownership: { kind: 'ownerless' },
        }),
      context,
    );
    await f.session.commit(
      (tx) =>
        tx.appendEntry(fork.id, {
          kind: 'pi.user',
          model: [{ role: 'user', content: 'child', timestamp: 3 }],
        }),
      context,
    );
    await f.reader.at('store', f.head());
    for (const limit of [1, 2, 100]) {
      const actual = await f.reader.scanEntries(
        { conversationId: fork.id },
        limit,
      );
      const expected = await f.storage.scanEntries(
        { conversationId: fork.id },
        limit,
        undefined,
        context,
      );
      expect(actual.items).toEqual(expected.items);
      expect(Boolean(actual.next)).toBe(Boolean(expected.next));
    }
    await f.session.close(context);
  });
});
