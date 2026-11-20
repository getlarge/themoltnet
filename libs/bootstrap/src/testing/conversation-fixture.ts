/** Test-only: the Pi commits behind the Go CLI conversation E2E fixture. */
import type { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import {
  MemoryStorage,
  type Seq,
  type StorageWrite,
} from '@earendil-works/pi-durable';

import { assistantMessage, createDurableSeed } from './durable.js';

/** The Go test replaces this attempt task ID with the task it claims. */
const FIXTURE_TASK_ID = '__TASK_ID__';

export const CONVERSATION_FIXTURE_URL = new URL(
  '../../../../apps/moltnet-cli/testdata/durable-conversation-commits.json',
  import.meta.url,
);

/** Replays the fixture conversation offline. Memory storage mints sequential
 * IDs and every timestamp is fixed, so the output is deterministic.
 */
export async function buildConversationFixtureCommits() {
  const commits: StorageWrite[][] = [];
  class Capture extends MemoryStorage {
    override async commit(
      batches: readonly (readonly StorageWrite[])[],
      receive: (index: number, seq: Seq) => void,
      ctx: typeof context,
    ) {
      return super.commit(
        batches,
        (index, seq) => {
          commits.push(
            JSON.parse(JSON.stringify(batches[index])) as StorageWrite[],
          );
          receive(index, seq);
        },
        ctx,
      );
    }
  }
  const seed = await createDurableSeed(
    new Capture(),
    { taskId: FIXTURE_TASK_ID, attemptN: 1 },
    [
      {
        kind: 'pi.user',
        model: [{ role: 'user', content: 'List the workspace.', timestamp: 1 }],
      },
    ],
  );
  try {
    await seed.append([
      {
        kind: 'pi.assistant',
        model: [
          {
            ...assistantMessage('Listing files.', 2),
            stopReason: 'toolUse',
            content: [
              { type: 'text', text: 'Listing files.' },
              {
                type: 'toolCall',
                id: 'call-1',
                name: 'bash',
                arguments: { command: 'ls' },
              },
            ],
          },
        ],
      },
      {
        kind: 'pi.tool',
        model: [
          {
            role: 'toolResult',
            toolCallId: 'call-1',
            toolName: 'bash',
            content: [{ type: 'text', text: 'README.md' }],
            isError: false,
            timestamp: 3,
          },
        ],
      },
    ]);
    await seed.append([
      {
        kind: 'pi.assistant',
        model: [assistantMessage('The workspace holds README.md.', 4)],
      },
    ]);
  } finally {
    await seed.close();
  }
  return commits;
}
