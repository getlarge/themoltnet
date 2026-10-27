/** Test-only: native Pi seeding for Node E2E setup and Go test fixtures. */
import { randomUUID } from 'node:crypto';

import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import {
  createSession,
  defineDocFamily,
  defineTask,
  type EntryDraft,
  type Id,
  LiveDoc,
  MemoryStorage,
  type Storage,
  type StorageWrite,
} from '@earendil-works/pi-durable';
import {
  appendRuntimeStoreCommit,
  mintRuntimeStoreId,
  openRuntimeStore,
  releaseRuntimeStore,
  renewRuntimeStore,
} from '@moltnet/api-client';

const Attempts = defineDocFamily({
  kind: 'moltnet.attempt',
  version: 1,
  scope: 'session',
  family: true,
  checkpointWhen: () => false,
  initial: (conversationId: number) => ({ conversationId }),
});
// Only persisted ownership is needed; a worker never executes this task.
const Subagent = defineTask({
  name: 'e2e.subagent',
  version: 1,
  initial: () => ({ phase: 'idle' as const }),
  phases: { idle: async () => {} },
  abort: async () => {},
});

/** Executor manifest shared by E2E claims pinned to a runtime profile. Only
 * the label varies, so each suite registers a distinct executor fingerprint.
 */
export function buildE2EExecutorManifest(
  profile: { id: string; definitionCid: string; runtimeKind: string },
  label: string,
) {
  return {
    schemaVersion: 'moltnet:executor-manifest:v1',
    runtime: {
      kind: profile.runtimeKind,
      engine: 'pi',
      sandbox: 'gondolin',
      id: `${label}-e2e`,
      version: '1',
    },
    profile: { id: profile.id, definitionCid: profile.definitionCid },
    vm: {
      templateId: `${label}-e2e`,
      templateVersion: '1',
      templateFingerprint: 'bafyreie2e-template',
      guestAssetBuildId: `${label}-e2e`,
    },
    tools: [] as { name: string }[],
    extensions: [] as { declaredTools: string[] }[],
    executables: [] as string[],
  };
}

export function assistantMessage(text: string, timestamp = 0) {
  return {
    role: 'assistant' as const,
    content: [{ type: 'text' as const, text }],
    timestamp,
    api: 'anthropic-messages' as const,
    provider: 'anthropic',
    model: 'fixture',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop' as const,
  };
}

/** The storage chooses whether commits go to the API or an offline capture. */
export async function createDurableSeed(
  storage: Storage,
  attempt: { taskId: string; attemptN: number },
  entries: EntryDraft[] = [],
) {
  const session = createSession(storage);
  try {
    const root = (
      await session.commit(
        (tx) => tx.createConversation({ ownership: { kind: 'ownerless' } }),
        context,
      )
    ).id;
    await session.commit(async (tx) => {
      await tx.doc(Attempts, `${attempt.taskId}/${attempt.attemptN}`, root);
      for (const entry of entries) await tx.appendEntry(root, entry);
    }, context);
    return {
      conversationId: String(root),
      append: (entries: EntryDraft[]) =>
        session.commit(async (tx) => {
          for (const entry of entries) await tx.appendEntry(root, entry);
        }, context),
      partial: (message?: ReturnType<typeof assistantMessage>) =>
        session.commit(async (tx) => {
          const live = await tx.doc(LiveDoc, root);
          live.generation = message ? { attempt: 1, message } : undefined;
        }, context),
      subagents: (children: EntryDraft[][]) =>
        session.commit(async (tx) => {
          const ids: string[] = [];
          for (const entries of children) {
            const taskId = await tx.createTask(
              Subagent,
              {},
              { conversationId: root, ownership: { kind: 'conversation' } },
            );
            const child = await tx.createConversation({
              ownership: { kind: 'task', taskId },
            });
            for (const entry of entries) await tx.appendEntry(child.id, entry);
            ids.push(String(child.id));
          }
          return ids;
        }, context),
      close: () => session.close(context),
    };
  } catch (error) {
    await session.close(context);
    throw error;
  }
}

type OpenOptions = NonNullable<Parameters<typeof openRuntimeStore>[0]>;
type Authority = Pick<
  OpenOptions['body'],
  'taskId' | 'attemptN' | 'leaseId' | 'executorFingerprint'
>;

/** Opens a fresh store and persists every Pi commit using the typed API client.
 * The caller owns task heartbeats and writer renewal/release timing.
 */
export async function openDurableSeed(
  options: Pick<OpenOptions, 'client' | 'auth' | 'headers'>,
  authority: Authority,
  entries: EntryDraft[] = [],
) {
  const request = { ...options, throwOnError: true as const };
  const opened = await openRuntimeStore({ ...request, body: authority });
  const { storeId, writerToken } = opened.data;
  const path = { storeId };
  const writer = { ...authority, writerToken };
  let head = opened.data.headSeq;
  const release = () => releaseRuntimeStore({ ...request, path, body: writer });
  try {
    if (head !== 0) throw new Error('A Durable seed requires an empty store');
    class RemoteStorage extends MemoryStorage {
      override async mintId<I extends Id<string>>(): Promise<I> {
        const result = await mintRuntimeStoreId({
          ...request,
          path,
          body: writer,
        });
        return result.data.id as I;
      }
      override async commit(writes: readonly StorageWrite[]) {
        const result = await appendRuntimeStoreCommit({
          ...request,
          path,
          body: {
            ...writer,
            commitId: randomUUID(),
            expectedSeq: head,
            writes: JSON.parse(JSON.stringify(writes)) as Record<
              string,
              unknown
            >[],
          },
        });
        head = result.data.seq;
        return super.commit(writes, context);
      }
    }
    const seed = await createDurableSeed(
      new RemoteStorage(),
      authority,
      entries,
    );
    return {
      ...seed,
      storeId,
      writer,
      get headSeq() {
        return head;
      },
      renew: () => renewRuntimeStore({ ...request, path, body: writer }),
      release,
    };
  } catch (error) {
    await release().catch(() => {});
    throw error;
  }
}
