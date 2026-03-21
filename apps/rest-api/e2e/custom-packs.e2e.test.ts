/**
 * E2E: Custom pack preview + create routes
 *
 * Models an external client (for example an Ax-powered agent) doing its own
 * retrieval and ranking, then using the server only for validation,
 * compression, CID computation, and persistence.
 */

import {
  type Client,
  createClient,
  createDiaryCustomPack,
  createDiaryEntry,
  getContextPackById,
  listDiaryEntries,
  listDiaryPacks,
  previewDiaryCustomPack,
  searchDiary,
} from '@moltnet/api-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, createTestVoucher, type TestAgent } from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

const LONG_AUTH_CONTENT =
  'Keto authorization debugging notes describe tuple checks, auth middleware ordering, token refresh behavior, and diary pack composition details. '.repeat(
    8,
  );

describe('Custom packs', () => {
  let harness: TestHarness;
  let client: Client;
  let agentA: TestAgent;
  let agentB: TestAgent;

  beforeAll(async () => {
    harness = await createTestHarness();
    client = createClient({ baseUrl: harness.baseUrl });

    const voucherA = await createTestVoucher({
      db: harness.db,
      issuerId: harness.bootstrapIdentityId,
    });
    agentA = await createAgent({
      baseUrl: harness.baseUrl,
      identityApi: harness.identityApi,
      hydraAdminOAuth2: harness.hydraAdminOAuth2,
      webhookApiKey: harness.webhookApiKey,
      voucherCode: voucherA,
    });

    const voucherB = await createTestVoucher({
      db: harness.db,
      issuerId: harness.bootstrapIdentityId,
    });
    agentB = await createAgent({
      baseUrl: harness.baseUrl,
      identityApi: harness.identityApi,
      hydraAdminOAuth2: harness.hydraAdminOAuth2,
      webhookApiKey: harness.webhookApiKey,
      voucherCode: voucherB,
    });

    await Promise.all([
      createDiaryEntry({
        client,
        auth: () => agentA.accessToken,
        path: { diaryId: agentA.moltnetDiaryId },
        body: {
          content: LONG_AUTH_CONTENT,
          tags: ['auth', 'keto'],
          title: 'Keto authorization debugging',
        },
      }),
      createDiaryEntry({
        client,
        auth: () => agentA.accessToken,
        path: { diaryId: agentA.moltnetDiaryId },
        body: {
          content:
            LONG_AUTH_CONTENT +
            ' Added notes about rate limiting and race-condition mitigation.',
          tags: ['auth', 'rate-limit'],
          title: 'Auth rate limit investigation',
        },
      }),
      createDiaryEntry({
        client,
        auth: () => agentA.accessToken,
        path: { diaryId: agentA.moltnetDiaryId },
        body: {
          content:
            LONG_AUTH_CONTENT +
            ' Persistence path validates entry ownership before pack creation.',
          tags: ['context-packs', 'auth'],
          title: 'Custom pack validation notes',
        },
      }),
      createDiaryEntry({
        client,
        auth: () => agentA.accessToken,
        path: { diaryId: agentA.moltnetDiaryId },
        body: {
          content:
            'Irrelevant deployment notes about Fly.io machine sizing and image rollout.',
          tags: ['deployment'],
          title: 'Deployment unrelated to auth',
        },
      }),
    ]);
  }, 60_000);

  afterAll(async () => {
    await harness?.teardown();
  });

  it('returns 401 for preview without auth', async () => {
    const response = await fetch(
      `${harness.baseUrl}/diaries/${agentA.moltnetDiaryId}/packs/preview`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          packType: 'custom',
          params: { recipe: 'ax-agent-selected' },
          entries: [
            {
              entryId: '00000000-0000-0000-0000-000000000000',
              rank: 1,
            },
          ],
        }),
      },
    );

    expect(response.status).toBe(401);
  });

  it('supports an Ax-style client-side composition flow', async () => {
    const { data: searchData, error: searchError } = await searchDiary({
      client,
      auth: () => agentA.accessToken,
      body: {
        diaryId: agentA.moltnetDiaryId,
        query: 'Keto authorization debugging',
        limit: 3,
      },
    });
    expect(
      searchError,
      `searchDiary failed: ${JSON.stringify(searchError)}`,
    ).toBeUndefined();

    const { data: listData, error: listError } = await listDiaryEntries({
      client,
      auth: () => agentA.accessToken,
      path: { diaryId: agentA.moltnetDiaryId },
      query: { tags: 'auth', limit: 10 },
    });
    expect(
      listError,
      `listDiaryEntries failed: ${JSON.stringify(listError)}`,
    ).toBeUndefined();

    // Simulate a client-side RAG selection manifest:
    // 1. semantic search for the task
    // 2. targeted tag fill for auth-related gaps
    // 3. client-side dedupe + explicit ranking
    const rankedEntryIds = [
      ...searchData!.results.map((entry) => entry.id),
      ...listData!.items.map((entry) => entry.id),
    ].filter((entryId, index, all) => all.indexOf(entryId) === index);

    const entries = rankedEntryIds.slice(0, 3).map((entryId, index) => ({
      entryId,
      rank: index + 1,
    }));
    expect(entries).toHaveLength(3);

    const { data: packsBefore, error: packsBeforeError } = await listDiaryPacks(
      {
        client,
        auth: () => agentA.accessToken,
        path: { id: agentA.moltnetDiaryId },
        query: { limit: 20 },
      },
    );
    expect(packsBeforeError).toBeUndefined();
    expect(packsBefore!.items).toHaveLength(0);

    const {
      data: previewData,
      error: previewError,
      response: previewResponse,
    } = await previewDiaryCustomPack({
      client,
      auth: () => agentA.accessToken,
      path: { id: agentA.moltnetDiaryId },
      body: {
        packType: 'custom',
        params: {
          recipe: 'ax-agent-selected',
          taskPrompt: 'Keto authorization debugging',
          selectionMethod: 'rag-multi-query',
        },
        entries,
        tokenBudget: 260,
      },
    });

    expect(
      previewError,
      `previewDiaryCustomPack failed: ${JSON.stringify(previewError)}`,
    ).toBeUndefined();
    expect(previewResponse.status).toBe(200);
    expect(previewData!.packType).toBe('custom');
    expect(previewData!.entries.length).toBeGreaterThan(0);
    expect(previewData!.entries.map((entry) => entry.rank)).toEqual(
      [...previewData!.entries.map((entry) => entry.rank)].sort(
        (a, b) => a - b,
      ),
    );
    expect(previewData!.compileStats.totalTokens).toBeLessThanOrEqual(260);
    expect(
      previewData!.entries.some((entry) => entry.compressionLevel !== 'full'),
    ).toBe(true);

    const { data: packsAfterPreview, error: packsAfterPreviewError } =
      await listDiaryPacks({
        client,
        auth: () => agentA.accessToken,
        path: { id: agentA.moltnetDiaryId },
        query: { limit: 20 },
      });
    expect(packsAfterPreviewError).toBeUndefined();
    expect(packsAfterPreview!.items).toHaveLength(0);

    const {
      data: createData,
      error: createError,
      response: createResponse,
    } = await createDiaryCustomPack({
      client,
      auth: () => agentA.accessToken,
      path: { id: agentA.moltnetDiaryId },
      body: {
        packType: 'custom',
        params: {
          recipe: 'ax-agent-selected',
          taskPrompt: 'Keto authorization debugging',
          selectionMethod: 'rag-multi-query',
        },
        entries,
        tokenBudget: 260,
        pinned: true,
      },
    });

    expect(
      createError,
      `createDiaryCustomPack failed: ${JSON.stringify(createError)}`,
    ).toBeUndefined();
    expect(createResponse.status).toBe(201);
    expect(createData!.packType).toBe('custom');
    expect(createData!.entries.length).toBeGreaterThan(0);

    const { data: packsAfterCreate, error: packsAfterCreateError } =
      await listDiaryPacks({
        client,
        auth: () => agentA.accessToken,
        path: { id: agentA.moltnetDiaryId },
        query: { expand: 'entries', limit: 20 },
      });
    expect(packsAfterCreateError).toBeUndefined();
    expect(packsAfterCreate!.items).toHaveLength(1);

    const persistedPack = packsAfterCreate!.items.find(
      (pack) => pack.packCid === createData!.packCid,
    );
    expect(persistedPack).toBeDefined();
    expect(persistedPack!.packType).toBe('custom');
    expect(persistedPack!.entries?.length).toBe(createData!.entries.length);

    const {
      data: fetchedPack,
      error: fetchedPackError,
      response: fetchedResponse,
    } = await getContextPackById({
      client,
      auth: () => agentA.accessToken,
      path: { id: persistedPack!.id },
      query: { expand: 'entries' },
    });
    expect(fetchedPackError).toBeUndefined();
    expect(fetchedResponse.status).toBe(200);
    expect(fetchedPack!.packType).toBe('custom');
    expect(
      fetchedPack!.entries?.every(
        (entry) => entry.entry.diaryId === agentA.moltnetDiaryId,
      ),
    ).toBe(true);

    const { error: forbiddenReadError, response: forbiddenReadResponse } =
      await getContextPackById({
        client,
        auth: () => agentB.accessToken,
        path: { id: persistedPack!.id },
      });
    expect(forbiddenReadError).toBeDefined();
    expect(forbiddenReadResponse.status).toBe(403);
  }, 120_000);

  it('returns 404 when another agent targets a diary they cannot read', async () => {
    const { error, response } = await previewDiaryCustomPack({
      client,
      auth: () => agentB.accessToken,
      path: { id: agentA.moltnetDiaryId },
      body: {
        packType: 'custom',
        params: { recipe: 'ax-agent-selected' },
        entries: [
          {
            entryId: '00000000-0000-0000-0000-000000000000',
            rank: 1,
          },
        ],
      },
    });

    expect(error).toBeDefined();
    expect(response.status).toBe(404);
  });

  it('rejects entry selections that do not belong to the target diary', async () => {
    const { data: foreignSearch } = await searchDiary({
      client,
      auth: () => agentA.accessToken,
      body: {
        diaryId: agentA.moltnetDiaryId,
        query: 'Keto authorization debugging',
        limit: 1,
      },
    });
    const foreignEntryId = foreignSearch!.results[0]!.id;

    const { error, response } = await createDiaryCustomPack({
      client,
      auth: () => agentB.accessToken,
      path: { id: agentB.moltnetDiaryId },
      body: {
        packType: 'custom',
        params: {
          recipe: 'ax-agent-selected',
          selectionMethod: 'foreign-entry-regression',
        },
        entries: [{ entryId: foreignEntryId, rank: 1 }],
      },
    });

    expect(error).toBeDefined();
    expect(response.status).toBe(400);
  });
});
