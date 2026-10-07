import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import type { ConversationId, StorageWrite } from '@earendil-works/pi-durable';
import {
  createExpectAssertions,
  createStorageConformance,
} from '@earendil-works/pi-durable/testing';
import { describe, expect, it } from 'vitest';

import { remoteLog } from '../__tests__/durable-log.js';
import { ApiDurableStorage } from './durable-storage.js';

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
