import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import {
  type ConversationId,
  MemoryStorage,
  type StorageWrite,
} from '@earendil-works/pi-durable';
import {
  createExpectAssertions,
  createStorageConformance,
} from '@earendil-works/pi-durable/testing';
import { describe, expect, it, vi } from 'vitest';

import {
  ApiDurableStorage,
  type DurableStoreTransport,
  type RuntimeCommit,
} from '../src/durable-storage.js';
import { remoteLog } from './durable-log.js';

describe('API Durable storage conformance', () => {
  for (const test of createStorageConformance({
    assertions: createExpectAssertions(expect),
    withStorage: async (use) => {
      const { transport } = remoteLog();
      const storage = await ApiDurableStorage.open(
        transport,
        BACKGROUND_CONTEXT,
      );
      try {
        await use(storage);
      } finally {
        await storage.close(BACKGROUND_CONTEXT);
      }
    },
  }))
    it(test.name, () => test.run());
});

describe('remote commit recovery', () => {
  it('rebuilds history in a fresh storage instance without local files', async () => {
    const { transport } = remoteLog();
    const first = await ApiDurableStorage.open(transport, BACKGROUND_CONTEXT);
    const ids: ConversationId[] = [];
    for (let n = 0; n < 5; n++) {
      const id = await first.mintId<ConversationId>();
      ids.push(id);
      await first.commit(
        [{ type: 'conversation', value: { id } }],
        BACKGROUND_CONTEXT,
      );
    }
    await first.close(BACKGROUND_CONTEXT);
    const restarted = await ApiDurableStorage.open(
      transport,
      BACKGROUND_CONTEXT,
    );
    expect(await restarted.conversation(ids[4], BACKGROUND_CONTEXT)).toEqual({
      id: ids[4],
    });
    expect(await restarted.mintId()).toBeGreaterThan(ids[4]);
    await restarted.close(BACKGROUND_CONTEXT);
  });
  it('reconciles a committed batch after its acknowledgment is lost', async () => {
    const { transport, commits } = remoteLog();
    const append = transport.append;
    transport.append = async (input, context) => {
      await append(input, context);
      throw new Error('lost acknowledgment');
    };
    const storage = await ApiDurableStorage.open(transport, BACKGROUND_CONTEXT);
    const id = await storage.mintId<ConversationId>();
    expect(
      await storage.commit(
        [{ type: 'conversation', value: { id } }],
        BACKGROUND_CONTEXT,
      ),
    ).toBe(1);
    expect(commits).toHaveLength(1);
    expect(transport.onUncertainCommit).not.toHaveBeenCalled();
    await storage.close(BACKGROUND_CONTEXT);
  });
  it('halts new writes after an unreconciled failure', async () => {
    const { transport } = remoteLog();
    transport.append = async () => {
      throw new Error('offline');
    };
    const storage = await ApiDurableStorage.open(transport, BACKGROUND_CONTEXT);
    const id = await storage.mintId<ConversationId>();
    const writes: StorageWrite[] = [{ type: 'conversation', value: { id } }];
    await expect(storage.commit(writes, BACKGROUND_CONTEXT)).rejects.toThrow(
      'offline',
    );
    await expect(storage.commit(writes, BACKGROUND_CONTEXT)).rejects.toThrow(
      'reopened',
    );
    expect(transport.onUncertainCommit).toHaveBeenCalledOnce();
    await storage.close(BACKGROUND_CONTEXT);
  });
  it('replays an asynchronous page and rejects a stream interrupted after a commit', async () => {
    const { transport, commits } = remoteLog();
    const first = await ApiDurableStorage.open(transport, BACKGROUND_CONTEXT);
    const id = await first.mintId<ConversationId>();
    await first.commit(
      [{ type: 'conversation', value: { id } }],
      BACKGROUND_CONTEXT,
    );
    await first.close(BACKGROUND_CONTEXT);
    transport.read = async () => ({
      headSeq: 1,
      items: (async function* () {
        yield commits[0];
      })(),
    });
    const replayed = await ApiDurableStorage.open(
      transport,
      BACKGROUND_CONTEXT,
    );
    expect(await replayed.conversation(id, BACKGROUND_CONTEXT)).toEqual({ id });
    await replayed.close(BACKGROUND_CONTEXT);
    transport.read = async () => ({
      headSeq: 1,
      items: (async function* () {
        yield commits[0];
        throw new Error('truncated stream');
      })(),
    });
    await expect(
      ApiDurableStorage.open(transport, BACKGROUND_CONTEXT),
    ).rejects.toThrow('truncated stream');
  });
});

describe('remote log integrity', () => {
  async function seeded() {
    const log = remoteLog();
    const storage = await ApiDurableStorage.open(
      log.transport,
      BACKGROUND_CONTEXT,
    );
    for (let n = 0; n < 2; n++) {
      const id = await storage.mintId<ConversationId>();
      await storage.commit(
        [{ type: 'conversation', value: { id } }],
        BACKGROUND_CONTEXT,
      );
    }
    await storage.close(BACKGROUND_CONTEXT);
    vi.mocked(log.transport.close).mockClear();
    return log;
  }
  const serve = (
    transport: DurableStoreTransport,
    headSeq: number,
    items: RuntimeCommit[],
  ) => {
    transport.read = async () => ({ headSeq, items });
  };

  it('rejects a sequence gap and releases the writer', async () => {
    const { transport, commits } = await seeded();
    serve(transport, 2, [commits[1]]);
    await expect(
      ApiDurableStorage.open(transport, BACKGROUND_CONTEXT),
    ).rejects.toThrow('Corrupt runtime commit log');
    expect(transport.close).toHaveBeenCalledOnce();
  });

  it('rejects a commit whose writes do not match its digest', async () => {
    const { transport, commits } = await seeded();
    serve(transport, 1, [{ ...commits[0], writes: commits[1].writes }]);
    await expect(
      ApiDurableStorage.open(transport, BACKGROUND_CONTEXT),
    ).rejects.toThrow('Corrupt runtime commit log');
  });

  it('rejects a page that makes no progress toward the head', async () => {
    const { transport } = await seeded();
    serve(transport, 2, []);
    await expect(
      ApiDurableStorage.open(transport, BACKGROUND_CONTEXT),
    ).rejects.toThrow('Incomplete runtime commit log');
  });

  it('rejects commits beyond the advertised head', async () => {
    const { transport, commits } = await seeded();
    serve(transport, 1, commits);
    await expect(
      ApiDurableStorage.open(transport, BACKGROUND_CONTEXT),
    ).rejects.toThrow('Incomplete runtime commit log');
  });

  it('poisons the store when the remote assigns another sequence', async () => {
    const { transport } = remoteLog();
    transport.append = async () => ({ seq: 7 });
    const storage = await ApiDurableStorage.open(transport, BACKGROUND_CONTEXT);
    const id = await storage.mintId<ConversationId>();
    const writes: StorageWrite[] = [{ type: 'conversation', value: { id } }];
    await expect(storage.commit(writes, BACKGROUND_CONTEXT)).rejects.toThrow(
      'Runtime commit sequence mismatch',
    );
    expect(transport.onUncertainCommit).toHaveBeenCalledOnce();
    await expect(storage.commit(writes, BACKGROUND_CONTEXT)).rejects.toThrow(
      'reopened',
    );
    await storage.close(BACKGROUND_CONTEXT);
  });

  it('does not adopt a recovered commit whose digest differs', async () => {
    const { transport, commits } = remoteLog();
    const append = transport.append;
    transport.append = async (input, context) => {
      await append(input, context);
      commits[0] = { ...commits[0], sha256: '0'.repeat(64) };
      throw new Error('lost acknowledgment');
    };
    const storage = await ApiDurableStorage.open(transport, BACKGROUND_CONTEXT);
    const id = await storage.mintId<ConversationId>();
    await expect(
      storage.commit(
        [{ type: 'conversation', value: { id } }],
        BACKGROUND_CONTEXT,
      ),
    ).rejects.toThrow('lost acknowledgment');
    expect(transport.onUncertainCommit).toHaveBeenCalledOnce();
    await storage.close(BACKGROUND_CONTEXT);
  });

  it('releases the writer when local teardown fails', async () => {
    const { transport } = remoteLog();
    const storage = await ApiDurableStorage.open(transport, BACKGROUND_CONTEXT);
    vi.spyOn(MemoryStorage.prototype, 'close').mockRejectedValueOnce(
      new Error('teardown failed'),
    );
    await expect(storage.close(BACKGROUND_CONTEXT)).rejects.toThrow(
      'teardown failed',
    );
    expect(transport.close).toHaveBeenCalledOnce();
  });
});
