import { createHash } from 'node:crypto';

import { vi } from 'vitest';

import type {
  DurableStoreTransport,
  RuntimeCommit,
} from '../src/durable-storage.js';
export function remoteLog() {
  const commits: RuntimeCommit[] = [];
  let nextId = 2;
  const transport: DurableStoreTransport = {
    read: vi.fn(async (afterSeq: number) => ({
      headSeq: commits.length,
      items: structuredClone(
        commits.filter((c) => c.seq > afterSeq).slice(0, 2),
      ),
    })),
    append: vi.fn(
      async (input: Parameters<DurableStoreTransport['append']>[0]) => {
        if (input.expectedSeq !== commits.length)
          throw new Error('head changed');
        const seq = commits.length + 1;
        commits.push({
          seq,
          commitId: input.commitId,
          writes: structuredClone(input.writes),
          sha256: createHash('sha256')
            .update(
              JSON.stringify({ format: 'pi-durable.v1', writes: input.writes }),
            )
            .digest('hex'),
        });
        for (const write of input.writes) {
          const id =
            'value' in write
              ? write.value.id
              : 'record' in write
                ? write.record.id
                : undefined;
          if (typeof id === 'number')
            nextId = Math.max(
              nextId,
              Math.min(id + 1, Number.MAX_SAFE_INTEGER),
            );
        }
        return { seq };
      },
    ),
    mintId: vi.fn(async () => {
      if (nextId >= Number.MAX_SAFE_INTEGER)
        throw new Error('ID space is exhausted');
      return nextId++;
    }),
    close: vi.fn(async () => {}),
    onUncertainCommit: vi.fn(),
  };
  return { transport, commits };
}
