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
  getContextPackProvenanceById,
  listContextPacks,
  listDiaryEntries,
  listDiaryPacks,
  previewDiaryCustomPack,
  searchDiary,
  updateContextPack,
} from '@moltnet/api-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, type TestAgent } from './helpers.js';
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

    agentA = await createAgent({
      baseUrl: harness.baseUrl,
      db: harness.db,
      bootstrapIdentityId: harness.bootstrapIdentityId,
    });

    agentB = await createAgent({
      baseUrl: harness.baseUrl,
      db: harness.db,
      bootstrapIdentityId: harness.bootstrapIdentityId,
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
      query: { tags: ['auth'], limit: 10 },
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
    const foreignEntryId = foreignSearch!.results[0].id;

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

  describe('GET /packs (team catalog)', () => {
    /**
     * This endpoint used to require `containsEntry` and 400 without it, which
     * is why the console pack catalog could never load: it lists a team's
     * packs and has no entry to filter by.
     */
    it('lists the team catalog with no diary or entry filter', async () => {
      const { data, error, response } = await listContextPacks({
        client,
        auth: () => agentA.accessToken,
        headers: { 'x-moltnet-team-id': agentA.personalTeamId },
        query: { limit: 20, offset: 0 },
      });

      expect(error).toBeUndefined();
      expect(response.status).toBe(200);
      expect(Array.isArray(data!.items)).toBe(true);
      expect(typeof data!.total).toBe('number');
    });

    it('requires the team header, since the catalog is team-scoped', async () => {
      const { response } = await listContextPacks({
        client,
        auth: () => agentA.accessToken,
        query: { limit: 20, offset: 0 },
      });

      expect(response.status).toBe(400);
    });

    it('still supports containsEntry as a filter', async () => {
      const { data: entries } = await listDiaryEntries({
        client,
        auth: () => agentA.accessToken,
        path: { diaryId: agentA.moltnetDiaryId },
        query: { limit: 1 },
      });

      const { error, response } = await listContextPacks({
        client,
        auth: () => agentA.accessToken,
        headers: { 'x-moltnet-team-id': agentA.personalTeamId },
        query: { containsEntry: entries!.items[0].id },
      });

      expect(error).toBeUndefined();
      expect(response.status).toBe(200);
    });

    it('rejects diaryId, which has its own route', async () => {
      const { response } = await listContextPacks({
        client,
        auth: () => agentA.accessToken,
        headers: { 'x-moltnet-team-id': agentA.personalTeamId },
        query: { diaryId: agentA.moltnetDiaryId },
      });

      expect(response.status).toBe(400);
    });

    it("does not leak another team's packs", async () => {
      const { data } = await listContextPacks({
        client,
        auth: () => agentB.accessToken,
        headers: { 'x-moltnet-team-id': agentB.personalTeamId },
        query: { limit: 100 },
      });

      // agentA seeded packs in its own team throughout this file.
      const diaryIds = new Set(data!.items.map((pack) => pack.diaryId));
      expect(diaryIds.has(agentA.moltnetDiaryId)).toBe(false);
    });
  });

  describe('supersession', () => {
    let olderPackId: string;
    let olderPackCid: string;

    async function makePack(recipe: string, supersedesPackId?: string) {
      const { data: entries } = await listDiaryEntries({
        client,
        auth: () => agentA.accessToken,
        path: { diaryId: agentA.moltnetDiaryId },
        query: { tags: ['auth'], limit: 2 },
      });

      const { data, error, response } = await createDiaryCustomPack({
        client,
        auth: () => agentA.accessToken,
        path: { id: agentA.moltnetDiaryId },
        body: {
          packType: 'custom',
          params: { recipe },
          entries: entries!.items.slice(0, 2).map((e, i) => ({
            entryId: e.id,
            rank: i + 1,
          })),
          ...(supersedesPackId ? { supersedesPackId } : {}),
        },
      });

      return { data, error, response };
    }

    it('creates the pack that will be superseded', async () => {
      const { data } = await makePack('supersede-base');
      expect(data).toBeDefined();
      olderPackCid = data!.packCid;

      const { data: packs } = await listDiaryPacks({
        client,
        auth: () => agentA.accessToken,
        path: { id: agentA.moltnetDiaryId },
      });
      olderPackId = packs!.items.find((p) => p.packCid === olderPackCid)!.id;
      expect(olderPackId).toBeDefined();
    }, 30_000);

    it('records supersession on the replacement pack', async () => {
      const { data, error } = await makePack('supersede-newer', olderPackId);
      expect(error).toBeUndefined();

      const { data: packs } = await listDiaryPacks({
        client,
        auth: () => agentA.accessToken,
        path: { id: agentA.moltnetDiaryId },
      });
      const newer = packs!.items.find((p) => p.packCid === data!.packCid);
      expect(newer!.supersedesPackId).toBe(olderPackId);
    }, 30_000);

    it('walks the chain in the provenance graph', async () => {
      // Before supersession could be written, this endpoint could only ever
      // return the root node: the BFS stops when supersedesPackId is null.
      const { data: packs } = await listDiaryPacks({
        client,
        auth: () => agentA.accessToken,
        path: { id: agentA.moltnetDiaryId },
      });
      const newer = packs!.items.find(
        (p) => p.supersedesPackId === olderPackId,
      );

      const { data: graph, error } = await getContextPackProvenanceById({
        client,
        auth: () => agentA.accessToken,
        path: { id: newer!.id },
      });

      expect(error).toBeUndefined();
      const packNodes = graph!.nodes.filter((n) => n.kind === 'pack');
      expect(packNodes.length).toBe(2);
      expect(
        graph!.edges.some(
          (e) => e.kind === 'supersedes' && e.from === `pack:${newer!.id}`,
        ),
      ).toBe(true);
    }, 30_000);

    it('rejects superseding a pack in a different diary with 400, not 500', async () => {
      const { data: entriesB } = await listDiaryEntries({
        client,
        auth: () => agentB.accessToken,
        path: { diaryId: agentB.moltnetDiaryId },
        query: { limit: 1 },
      });

      const { error, response } = await createDiaryCustomPack({
        client,
        auth: () => agentB.accessToken,
        path: { id: agentB.moltnetDiaryId },
        body: {
          packType: 'custom',
          params: { recipe: 'cross-diary' },
          entries: (entriesB?.items ?? [])
            .slice(0, 1)
            .map((e, i) => ({ entryId: e.id, rank: i + 1 })),
          supersedesPackId: olderPackId,
        },
      });

      // Asserting only that `error` is set would pass on a 500: the generated
      // client populates `error` for any non-2xx. The status is the assertion
      // that catches an untranslated PackServiceError.
      expect(error).toBeDefined();
      expect(response.status).toBe(400);
    }, 30_000);

    // No e2e for the read-check on the supersession target: the same-diary rule
    // is enforced first, and pack permissions are inherited from the diary, so
    // an actor able to create a pack in a diary can read that diary's packs.
    // The check is defence-in-depth rather than a reachable path — it is
    // covered directly in the ContextPackService unit tests instead.
    it('rejects a retry that changes supersession, rather than dropping it', async () => {
      // Same content as the base pack, but now claiming to supersede it. The
      // CID matches, so this hits the idempotent path; silently returning the
      // original would discard the pointer.
      const { response } = await makePack('supersede-base', olderPackId);

      expect(response.status).toBe(409);
    }, 30_000);
  });

  describe('PATCH /packs/:id (pin/unpin/expiry)', () => {
    let packId: string;

    it('creates a non-pinned custom pack to use in subsequent tests', async () => {
      const { data: entries } = await listDiaryEntries({
        client,
        auth: () => agentA.accessToken,
        path: { diaryId: agentA.moltnetDiaryId },
        query: { tags: ['auth'], limit: 2 },
      });
      expect(entries!.items.length).toBeGreaterThanOrEqual(2);

      const { data } = await createDiaryCustomPack({
        client,
        auth: () => agentA.accessToken,
        path: { id: agentA.moltnetDiaryId },
        body: {
          packType: 'custom',
          params: { recipe: 'pin-test' },
          entries: entries!.items.slice(0, 2).map((e, i) => ({
            entryId: e.id,
            rank: i + 1,
          })),
        },
      });
      expect(data).toBeDefined();

      // Find the persisted pack by CID
      const { data: packs } = await listDiaryPacks({
        client,
        auth: () => agentA.accessToken,
        path: { id: agentA.moltnetDiaryId },
      });
      const match = packs!.items.find((p) => p.packCid === data!.packCid);
      expect(match).toBeDefined();
      packId = match!.id;
    }, 30_000);

    it('pins a pack', async () => {
      const { data, error } = await updateContextPack({
        client,
        auth: () => agentA.accessToken,
        path: { id: packId },
        body: { pinned: true },
      });
      expect(error).toBeUndefined();
      expect(data!.pinned).toBe(true);
      expect(data!.expiresAt).toBeNull();
    });

    it('rejects expiresAt update on pinned pack', async () => {
      const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const { error, response } = await updateContextPack({
        client,
        auth: () => agentA.accessToken,
        path: { id: packId },
        body: { expiresAt: future.toISOString() },
      });
      expect(error).toBeDefined();
      expect(response.status).toBe(400);
    });

    it('unpins with new expiresAt', async () => {
      const future = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
      const { data, error } = await updateContextPack({
        client,
        auth: () => agentA.accessToken,
        path: { id: packId },
        body: { pinned: false, expiresAt: future.toISOString() },
      });
      expect(error).toBeUndefined();
      expect(data!.pinned).toBe(false);
      expect(data!.expiresAt).toBeDefined();
    });

    it('updates expiresAt on non-pinned pack', async () => {
      const newFuture = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const { data, error } = await updateContextPack({
        client,
        auth: () => agentA.accessToken,
        path: { id: packId },
        body: { expiresAt: newFuture.toISOString() },
      });
      expect(error).toBeUndefined();
      expect(data!.pinned).toBe(false);
    });

    it('rejects unpin without expiresAt', async () => {
      // First pin it again
      await updateContextPack({
        client,
        auth: () => agentA.accessToken,
        path: { id: packId },
        body: { pinned: true },
      });

      const { error, response } = await updateContextPack({
        client,
        auth: () => agentA.accessToken,
        path: { id: packId },
        body: { pinned: false },
      });
      expect(error).toBeDefined();
      expect(response.status).toBe(400);
    });

    it('rejects update from another agent (403)', async () => {
      const { error, response } = await updateContextPack({
        client,
        auth: () => agentB.accessToken,
        path: { id: packId },
        body: { pinned: true },
      });
      expect(error).toBeDefined();
      expect(response.status).toBe(403);
    });

    it('rejects past expiresAt', async () => {
      const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
      // Unpin first so we can test expiresAt update
      await updateContextPack({
        client,
        auth: () => agentA.accessToken,
        path: { id: packId },
        body: {
          pinned: false,
          expiresAt: new Date(
            Date.now() + 7 * 24 * 60 * 60 * 1000,
          ).toISOString(),
        },
      });

      const { error, response } = await updateContextPack({
        client,
        auth: () => agentA.accessToken,
        path: { id: packId },
        body: { expiresAt: past.toISOString() },
      });
      expect(error).toBeDefined();
      expect(response.status).toBe(400);
    });
  });
});
