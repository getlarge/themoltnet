/**
 * E2E: Durable task conversations
 *
 * Writes a pi-durable.v1 store through the runtime store API with Pi's own
 * storage writes, then reads it back through the task conversation API.
 */

import { randomUUID } from 'node:crypto';

import {
  appendRuntimeStoreCommit,
  type Client,
  completeTask,
  createClient,
  getRuntimeStoreForAttempt,
  getTask,
  getTaskConversation,
  listTaskConversations,
  mintRuntimeStoreId,
  openRuntimeStore,
  releaseRuntimeStore,
  taskHeartbeat,
  watchTaskConversation,
} from '@moltnet/api-client';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Node E2E fixture setup.
import {
  assistantMessage,
  openDurableSeed,
} from '@moltnet/bootstrap/testing/durable';
import {
  buildExecutorCompleteAttestationPayload,
  computeJsonCid,
  signExecutorAttestation,
} from '@moltnet/crypto-service';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { claimPinnedAttempt, type PinnedClaim } from './durable-claims.js';
import { createAgent, pollUntil, type TestAgent } from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

function roleOf({ message }: { message: unknown }) {
  return (message as { role?: string }).role;
}

describe('Task conversations API', () => {
  let harness: TestHarness;
  let client: Client;
  let owner: TestAgent;
  let outsider: TestAgent;

  beforeAll(async () => {
    harness = await createTestHarness();
    client = createClient({ baseUrl: harness.baseUrl });
    [owner, outsider] = await Promise.all([
      createAgent({
        baseUrl: harness.baseUrl,
        db: harness.db,
        bootstrapIdentityId: harness.bootstrapIdentityId,
      }),
      createAgent({
        baseUrl: harness.baseUrl,
        db: harness.db,
        bootstrapIdentityId: harness.bootstrapIdentityId,
      }),
    ]);
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  const team = () => ({ 'x-moltnet-team-id': owner.personalTeamId });

  const claimPinned = () =>
    claimPinnedAttempt(client, owner, 'task-conversations');

  async function writeConversation(authority: PinnedClaim) {
    const seed = await openDurableSeed(
      { client, auth: () => owner.accessToken, headers: team() },
      authority,
      [
        {
          kind: 'pi.user',
          model: [
            { role: 'user', content: 'Summarize the brief.', timestamp: 1 },
          ],
        },
        {
          kind: 'pi.assistant',
          model: [assistantMessage('The brief is summarized.', 2)],
        },
      ],
    );
    await seed.close();
    return { storeId: seed.storeId, writer: seed.writer, head: seed.headSeq };
  }

  it('reads a persisted Durable conversation for the attempt', async () => {
    const authority = await claimPinned();
    const { storeId, writer, head } = await writeConversation(authority);
    const path = { id: authority.taskId, n: authority.attemptN };

    const store = await getRuntimeStoreForAttempt({
      client,
      auth: () => owner.accessToken,
      headers: team(),
      query: { taskId: authority.taskId, attemptN: authority.attemptN },
    });
    expect(store.error).toBeUndefined();
    expect(store.data).toMatchObject({ storeId, headSeq: head });

    const listed = await listTaskConversations({
      client,
      auth: () => owner.accessToken,
      headers: team(),
      path,
    });
    expect(listed.error).toBeUndefined();
    expect(listed.data!.items).toEqual([
      expect.objectContaining({ parentConversationId: null, kind: 'main' }),
    ]);
    const conversationId = listed.data!.items[0].conversationId;

    const read = await getTaskConversation({
      client,
      auth: () => owner.accessToken,
      headers: team(),
      path: { ...path, conversationId },
    });
    expect(read.error).toBeUndefined();
    expect(read.data!.conversationId).toBe(conversationId);
    expect(read.data!.nextBeforeEntryId).toBeNull();
    expect(
      read.data!.messages.map((entry) => ({
        inherited: entry.inherited,
        role: roleOf(entry),
      })),
    ).toEqual([
      { inherited: false, role: 'user' },
      { inherited: false, role: 'assistant' },
    ]);
    expect(JSON.stringify(read.data!.messages)).toContain(
      'The brief is summarized.',
    );

    // Older history pages through beforeEntryId.
    const newestEntryId = read.data!.messages.at(-1)?.entryId;
    expect(newestEntryId).toEqual(expect.any(String));
    const older = await getTaskConversation({
      client,
      auth: () => owner.accessToken,
      headers: team(),
      path: { ...path, conversationId },
      query: { beforeEntryId: newestEntryId! },
    });
    expect(older.error).toBeUndefined();
    expect(older.data!.messages.map(roleOf)).toEqual(['user']);

    // Reading never takes the writer lease: the executor can still release it.
    const released = await releaseRuntimeStore({
      client,
      auth: () => owner.accessToken,
      headers: team(),
      path: { storeId },
      body: writer,
    });
    expect(released.response?.status).toBe(204);
  });

  it('returns not found for an unknown conversation', async () => {
    const authority = await claimPinned();
    await writeConversation(authority);

    const read = await getTaskConversation({
      client,
      auth: () => owner.accessToken,
      headers: team(),
      path: {
        id: authority.taskId,
        n: authority.attemptN,
        conversationId: '999999',
      },
    });
    expect(read.response?.status).toBe(404);
  });

  it('hides conversations from agents outside the task team', async () => {
    const authority = await claimPinned();
    await writeConversation(authority);
    const path = { id: authority.taskId, n: authority.attemptN };
    const listed = await listTaskConversations({
      client,
      auth: () => owner.accessToken,
      headers: team(),
      path,
    });
    expect(listed.error).toBeUndefined();
    const { conversationId } = listed.data!.items[0];

    // In its own team the outsider cannot see the task at all.
    const ownTeam = await listTaskConversations({
      client,
      auth: () => outsider.accessToken,
      headers: { 'x-moltnet-team-id': outsider.personalTeamId },
      path,
    });
    expect(ownTeam.response?.status).toBe(404);

    // The auth plugin rejects a team header naming a team it is not in.
    const foreignTeam = await listTaskConversations({
      client,
      auth: () => outsider.accessToken,
      headers: team(),
      path,
    });
    expect(foreignTeam.response?.status).toBe(403);

    const snapshot = await getTaskConversation({
      client,
      auth: () => outsider.accessToken,
      headers: team(),
      path: { ...path, conversationId },
    });
    expect(snapshot.response?.status).toBe(403);
  });

  it('keeps cold list, pagination and live reads independent of durable history size', async () => {
    const authority = await claimPinnedAttempt(
      client,
      owner,
      'conversation-perf',
      { leaseTtlSec: 300 },
    );
    const opaqueContent = 'tool output: file\u0000name\ud800';
    const seed = await openDurableSeed(
      { client, auth: () => owner.accessToken, headers: team() },
      authority,
      Array.from({ length: 120 }, (_, i) => ({
        kind: 'pi.user',
        model: [
          {
            role: 'user' as const,
            content: i === 119 ? opaqueContent : `message ${i}`,
            timestamp: i,
          },
        ],
      })),
    );
    const request = {
      client,
      auth: () => owner.accessToken,
      headers: team(),
      path: { id: authority.taskId, n: authority.attemptN },
    };
    const timings: { commits: number; listMs: number; pageMs: number }[] = [];
    let updates = 0;
    try {
      for (const target of [20, 250, 1000]) {
        while (updates < target) {
          if (updates % 50 === 0) await seed.renew();
          await seed.partial(
            assistantMessage(`partial ${++updates} ${opaqueContent}`, updates),
          );
        }
        // Break only this test's object references, leaving immutable blobs intact.
        // Any fallback to full-log download now fails. This works across cold
        // processes too: the assertion does not depend on a replay cache TTL.
        await harness.db.execute(
          sql`UPDATE runtime_store_commits SET object_key = 'unreadable-e2e/' || object_key WHERE store_id = ${seed.storeId}`,
        );
        try {
          const start = performance.now();
          const listed = await listTaskConversations(request);
          const listMs = performance.now() - start;
          expect(listed.error).toBeUndefined();
          expect(listed.data!.items[0].conversationId).toBe(
            seed.conversationId,
          );
          const pageStart = performance.now();
          const latest = await getTaskConversation({
            ...request,
            path: { ...request.path, conversationId: seed.conversationId },
            query: { limit: 10 },
          });
          const pageMs = performance.now() - pageStart;
          expect(latest.error).toBeUndefined();
          expect(
            latest.data!.messages.filter((m) => m.entryId !== null),
          ).toHaveLength(10);
          expect(JSON.stringify(latest.data!.messages.at(-1))).toContain(
            `partial ${updates}`,
          );
          expect(JSON.stringify(latest.data!.messages)).toContain(
            JSON.stringify(opaqueContent),
          );
          const older = await getTaskConversation({
            ...request,
            path: { ...request.path, conversationId: seed.conversationId },
            query: {
              limit: 10,
              beforeEntryId: latest.data!.nextBeforeEntryId!,
            },
          });
          expect(older.error).toBeUndefined();
          expect(older.data!.messages).toHaveLength(10);
          expect(older.data!.messages.every((m) => m.entryId !== null)).toBe(
            true,
          );
          expect(
            new Set(
              [...latest.data!.messages, ...older.data!.messages].map(
                (m) => m.id,
              ),
            ).size,
          ).toBe(21);
          timings.push({ commits: seed.headSeq, listMs, pageMs });
        } finally {
          await harness.db.execute(
            sql`UPDATE runtime_store_commits SET object_key = substring(object_key from 16) WHERE store_id = ${seed.storeId} AND object_key LIKE 'unreadable-e2e/%'`,
          );
        }
      }
      console.table(timings);
      // Removing the rebuildable view simulates a pre-upgrade store. The first
      // read backfills it; the next read must not need its object history.
      await harness.db.execute(
        sql`DELETE FROM runtime_conversation_records WHERE store_id = ${seed.storeId}`,
      );
      await harness.db.execute(
        sql`DELETE FROM runtime_conversation_heads WHERE store_id = ${seed.storeId}`,
      );
      const rebuilt = await Promise.all([
        listTaskConversations(request),
        listTaskConversations(request),
      ]);
      for (const result of rebuilt) {
        expect(result.error).toBeUndefined();
        expect(result.data!.items[0].conversationId).toBe(seed.conversationId);
      }
      await harness.db.execute(
        sql`UPDATE runtime_store_commits SET object_key = 'unreadable-e2e/' || object_key WHERE store_id = ${seed.storeId}`,
      );
      try {
        const afterBackfill = await getTaskConversation({
          ...request,
          path: { ...request.path, conversationId: seed.conversationId },
          query: { limit: 10 },
        });
        expect(afterBackfill.error).toBeUndefined();
        expect(JSON.stringify(afterBackfill.data!.messages)).toContain(
          JSON.stringify(opaqueContent),
        );
        expect(JSON.stringify(afterBackfill.data!.messages.at(-1))).toContain(
          'partial 1000',
        );
      } finally {
        await harness.db.execute(
          sql`UPDATE runtime_store_commits SET object_key = substring(object_key from 16) WHERE store_id = ${seed.storeId} AND object_key LIKE 'unreadable-e2e/%'`,
        );
      }
      const result = await harness.db.execute(
        sql`SELECT seq FROM runtime_conversation_heads WHERE store_id = ${seed.storeId}`,
      );
      expect(result.rows[0].seq).toBe(seed.headSeq);
    } finally {
      await seed.release();
      await seed.close();
    }
  }, 180_000);

  it('streams committed partial updates and lists subagents from the read model', async () => {
    const authority = await claimPinned();
    const seed = await openDurableSeed(
      { client, auth: () => owner.accessToken, headers: team() },
      authority,
    );
    const request = {
      client,
      auth: () => owner.accessToken,
      headers: team(),
      path: { id: authority.taskId, n: authority.attemptN },
    };
    const controller = new AbortController();
    try {
      const [child] = await seed.subagents([
        [{ kind: 'pi.assistant', model: [assistantMessage('child result')] }],
      ]);
      await seed.partial(assistantMessage('first partial'));
      const listed = await listTaskConversations(request);
      expect(listed.error).toBeUndefined();
      expect(listed.data!.items).toContainEqual({
        conversationId: child,
        parentConversationId: seed.conversationId,
        kind: 'subagent',
      });
      const childRead = await getTaskConversation({
        ...request,
        path: { ...request.path, conversationId: child },
      });
      expect(childRead.error).toBeUndefined();
      expect(JSON.stringify(childRead.data!.messages)).toContain(
        'child result',
      );
      const events = await watchTaskConversation({
        ...request,
        path: { ...request.path, conversationId: seed.conversationId },
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(10_000),
        ]),
        sseMaxRetryAttempts: 0,
      });
      const first = await events.stream.next();
      expect(JSON.stringify(first.value)).toContain('first partial');
      await seed.partial(assistantMessage('updated partial'));
      const next = await events.stream.next();
      expect(JSON.stringify(next.value)).toContain('updated partial');
      controller.abort();
      await events.stream.return(undefined);
    } finally {
      controller.abort();
      await seed.release();
      await seed.close();
    }
  });

  it.each(['fork', 'extend'] as const)(
    'preserves inherited messages and freezes the parent attempt with %s',
    async (mode) => {
      const parent = await claimPinnedAttempt(
        client,
        owner,
        'conversation-parent',
        { taskType: 'freeform' },
      );
      const options = {
        client,
        auth: () => owner.accessToken,
        headers: team(),
      };
      const seed = await openDurableSeed(options, parent, [
        {
          kind: 'pi.user',
          model: [{ role: 'user', content: 'parent history', timestamp: 1 }],
        },
      ]);
      await seed.release();
      await seed.close();
      await taskHeartbeat({
        ...options,
        path: { id: parent.taskId, n: parent.attemptN },
        body: { leaseTtlSec: 120 },
      });
      const source = await getTask({
        ...options,
        path: { id: parent.taskId },
        throwOnError: true,
      });
      const output = {
        summary: 'Parent complete',
        verification: {
          inputCid: source.data.inputCid,
          results: [],
          passed: true,
        },
      };
      const outputCid = await computeJsonCid(output);
      const manifests = await harness.db.execute(
        sql`SELECT manifest FROM executor_manifests WHERE fingerprint = ${parent.executorFingerprint}`,
      );
      const executorManifest = manifests.rows[0].manifest as Record<
        string,
        unknown
      >;
      const executorSignature = await signExecutorAttestation(
        buildExecutorCompleteAttestationPayload({
          taskId: parent.taskId,
          attemptN: parent.attemptN,
          outputCid,
          executorFingerprint: parent.executorFingerprint,
        }),
        owner.keyPair.privateKey,
      );
      const completed = await completeTask({
        ...options,
        path: { id: parent.taskId, n: parent.attemptN },
        body: {
          executorManifest,
          executorFingerprint: parent.executorFingerprint,
          executorSignature,
          output,
          outputCid,
          usage: { model: 'fixture', inputTokens: 0, outputTokens: 0 },
        },
      });
      expect(completed.error).toBeUndefined();
      await pollUntil(
        () =>
          getTask({
            ...options,
            path: { id: parent.taskId },
            throwOnError: true,
          }),
        (r) => r.data.status === 'completed',
      );
      const child = await claimPinnedAttempt(
        client,
        owner,
        `conversation-${mode}`,
        {
          continueFrom: {
            taskId: parent.taskId,
            attemptN: parent.attemptN,
            mode,
          },
        },
      );
      const opened = await openRuntimeStore({
        ...options,
        body: child,
        throwOnError: true,
      });
      const storeId = opened.data.storeId;
      expect(storeId === seed.storeId).toBe(mode === 'extend');
      const writer = { ...child, writerToken: opened.data.writerToken };
      const doc = await mintRuntimeStoreId({
        ...options,
        path: { storeId },
        body: writer,
        throwOnError: true,
      });
      const entry = await mintRuntimeStoreId({
        ...options,
        path: { storeId },
        body: writer,
        throwOnError: true,
      });
      const appended = await appendRuntimeStoreCommit({
        ...options,
        path: { storeId },
        body: {
          ...writer,
          commitId: randomUUID(),
          expectedSeq: opened.data.headSeq,
          writes: [
            {
              type: 'document.create',
              record: {
                id: doc.data.id,
                kind: 'moltnet.attempt',
                key: `${child.taskId}/${child.attemptN}`,
                scope: { kind: 'session' },
              },
              content: {
                kind: 'base',
                version: 1,
                value: { conversationId: Number(seed.conversationId) },
              },
            },
            {
              type: 'entry',
              value: {
                id: entry.data.id,
                conversationId: Number(seed.conversationId),
                kind: 'pi.user',
                model: [
                  { role: 'user', content: 'child history', timestamp: 2 },
                ],
              },
            },
          ],
        },
      });
      expect(appended.error).toBeUndefined();
      try {
        const result = await getTaskConversation({
          ...options,
          path: {
            id: child.taskId,
            n: child.attemptN,
            conversationId: seed.conversationId,
          },
        });
        expect(result.error).toBeUndefined();
        expect(
          result.data!.messages.map((m) => ({
            inherited: m.inherited,
            content: m.message.content,
          })),
        ).toEqual([
          { inherited: true, content: 'parent history' },
          { inherited: false, content: 'child history' },
        ]);
        const original = await getTaskConversation({
          ...options,
          path: {
            id: parent.taskId,
            n: parent.attemptN,
            conversationId: seed.conversationId,
          },
        });
        expect(original.error).toBeUndefined();
        expect(original.data!.messages).toHaveLength(1);
        expect(original.data!.messages[0].message.content).toBe(
          'parent history',
        );
      } finally {
        await releaseRuntimeStore({
          ...options,
          path: { storeId },
          body: writer,
        });
      }
    },
  );

  it('requires team context', async () => {
    const authority = await claimPinned();
    const listed = await listTaskConversations({
      client,
      auth: () => owner.accessToken,
      // @ts-expect-error -- deliberately omits the required team header.
      headers: {},
      path: { id: authority.taskId, n: authority.attemptN },
    });
    expect(listed.response?.status).toBe(400);
  });
});
