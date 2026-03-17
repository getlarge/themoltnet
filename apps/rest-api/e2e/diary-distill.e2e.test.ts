/**
 * E2E: Diary distill routes — consolidate + compile
 *
 * Runs against the Docker Compose e2e stack (rest-api built from Dockerfile
 * with DBOS and the embedding model wired in).
 *
 * Covers:
 * - Auth/ownership/validation (401, 403, 404, 400) — fast, no embedding
 * - Happy path for consolidate on an empty diary — returns immediately (no entries → no embedding)
 * - Happy path for compile on a seeded diary — triggers embedding model (longer timeout)
 */

import {
  type Client,
  compileDiary,
  consolidateDiary,
  createClient,
  createDiaryEntry as apiCreateDiaryEntry,
} from '@moltnet/api-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, createTestVoucher, type TestAgent } from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

const NULL_UUID = '00000000-0000-0000-0000-000000000000';

describe('Diary distill — consolidate + compile', () => {
  let harness: TestHarness;
  let client: Client;
  let agentA: TestAgent;
  let agentB: TestAgent;
  let agentAEntryIds: string[];

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

    // Seed many entries into agentA's moltnet diary so consolidate can form
    // clusters and compile has a meaningful budget-packing problem to solve.
    // (Private diaries will not have embeddings in the future.)
    const seedEntries = [
      // Auth & security cluster
      {
        content:
          'Fixed a race condition in the auth middleware by adding a mutex around the token refresh logic. The root cause was concurrent requests both finding an expired token and both trying to refresh.',
        tags: ['auth', 'bug'],
      },
      {
        content:
          'Rotated the JWT signing key. All existing tokens remain valid until their natural expiry — the old key is kept as a verification-only key for 24 hours.',
        tags: ['auth', 'security'],
      },
      {
        content:
          'Added rate limiting to the /auth/token endpoint: 10 req/min per IP. Hammer test passed — 429s issued correctly after burst.',
        tags: ['auth', 'rate-limit'],
      },
      // Database cluster
      {
        content:
          'Switched from REST polling to WebSocket for real-time updates. Reduced server load by 70% — polling was hammering /status every 2 seconds per client.',
        tags: ['architecture', 'websocket'],
      },
      {
        content:
          'Refactored the database connection pool to reuse connections properly. Was leaking one connection per request in the old code due to missing pool.release() in error paths.',
        tags: ['database', 'bug'],
      },
      {
        content:
          'Added a read replica for analytics queries. All SELECTs in the reporting module now go to replica. Reduced primary DB load by 40%.',
        tags: ['database', 'performance'],
      },
      {
        content:
          'Migrated diary_entries table to use pgvector extension. Embedding column is now vector(384). Existing rows have NULL embeddings — backfill job scheduled.',
        tags: ['database', 'migration', 'embeddings'],
      },
      // Embeddings cluster
      {
        content:
          'Integrated e5-small-v2 for diary entry embeddings. Model loads via @huggingface/transformers. First-load takes ~3s (model download), subsequent calls are fast.',
        tags: ['embeddings', 'ml'],
      },
      {
        content:
          'Wrote the embedding backfill script: iterates diary_entries in pages of 100, calls embeddingService.embed(), writes back to DB. Ran on prod — 12k rows in 4 minutes.',
        tags: ['embeddings', 'migration'],
      },
      {
        content:
          'Added embedding cache to avoid re-embedding identical content on update. Cache key is SHA256(content). Hit rate after 24h: 18%.',
        tags: ['embeddings', 'performance'],
      },
      // Observability cluster
      {
        content:
          'Wired OpenTelemetry traces to Axiom. All Fastify requests now produce spans with http.method, http.route, http.status_code attributes.',
        tags: ['observability', 'otel'],
      },
      {
        content:
          'Added p95 latency dashboard in Axiom. Currently: auth endpoints <50ms, diary CRUD <120ms, search <800ms (embedding dominates).',
        tags: ['observability', 'performance'],
      },
      // MCP & agent cluster
      {
        content:
          'Implemented consolidateWorkflow in DBOS — clusters semantically similar diary entries using cosine similarity. WorkflowQueue concurrency set to 1 per agent to prevent resource contention.',
        tags: ['mcp', 'dbos', 'context-distill'],
      },
      {
        content:
          'Implemented compileWorkflow — MMR selection within token budget. Lambda=0.5 balances relevance vs diversity. Tested with 200 entries at 4000 token budget: 12 entries selected.',
        tags: ['mcp', 'dbos', 'context-distill'],
      },
      {
        content:
          'LeGreffier MCP server connects at /mcp. All tools require OAuth2 bearer token. Tested with claude-code client — diary create/list/search all working.',
        tags: ['mcp', 'legreffier'],
      },
      // Deployment cluster
      {
        content:
          'Deployed to Fly.io. Machine size: shared-cpu-2x with 512MB RAM. Autoscaling between 1–3 instances. P95 cold-start: 1.2s.',
        tags: ['deployment', 'fly-io'],
      },
      {
        content:
          'Set up GitHub Actions CI: lint → typecheck → test → build → push to GHCR → deploy. Full pipeline takes ~8 minutes.',
        tags: ['ci', 'deployment'],
      },
      {
        content:
          'Migrated secrets from .env to dotenvx encrypted .env. Decryption key stored in Fly.io secrets. Removed all plaintext secrets from git history.',
        tags: ['security', 'deployment'],
      },
      // API design cluster
      {
        content:
          'Split diary.ts routes into diary.ts (CRUD), diary-entries.ts (entry CRUD), and diary-distill.ts (reflect/consolidate/compile). Each file is now under 300 lines.',
        tags: ['api', 'refactor'],
      },
      {
        content:
          'Added TypeBox schemas for all new endpoint request/response types. Schemas registered in sharedSchemas array for OpenAPI generation.',
        tags: ['api', 'typescript'],
      },
    ];

    const seeded = await Promise.all(
      seedEntries.map((entry) =>
        apiCreateDiaryEntry({
          client,
          auth: () => agentA.accessToken,
          path: { diaryId: agentA.moltnetDiaryId },
          body: entry,
        }),
      ),
    );
    agentAEntryIds = seeded.map((r) => r.data!.id);
  }, 60_000);

  afterAll(async () => {
    await harness?.teardown();
  });

  // ── POST /diaries/:id/consolidate ──────────────────────────

  describe('POST /diaries/:id/consolidate', () => {
    it('returns 401 without auth', async () => {
      const response = await fetch(
        `${harness.baseUrl}/diaries/${NULL_UUID}/consolidate`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        },
      );
      expect(response.status).toBe(401);
    });

    it('returns 404 for non-existent diary', async () => {
      const { error, response } = await consolidateDiary({
        client,
        auth: () => agentA.accessToken,
        path: { id: NULL_UUID },
        body: {},
      });
      expect(error).toBeDefined();
      expect(response.status).toBe(404);
    });

    it('returns 404 when agent B requests agent A diary', async () => {
      // findDiary scopes by identityId — non-owner gets 404 (not 403) to avoid
      // leaking diary existence information
      const { error, response } = await consolidateDiary({
        client,
        auth: () => agentB.accessToken,
        path: { id: agentA.moltnetDiaryId },
        body: {},
      });
      expect(error).toBeDefined();
      expect(response.status).toBe(404);
    });

    it('does not leak cross-diary entries when agent B supplies agent A entry UUIDs', async () => {
      // Security regression test for the authorization bypass:
      // Agent B passes agent A's real entry UUIDs into their own diary's
      // consolidate call. fetchEntriesStep must scope by diaryId AND ids —
      // so all supplied UUIDs must be filtered out (none belong to B's diary).
      const { data, error } = await consolidateDiary({
        client,
        auth: () => agentB.accessToken,
        path: { id: agentB.moltnetDiaryId },
        body: { entryIds: agentAEntryIds },
      });
      expect(error).toBeUndefined();
      expect(data!.stats.inputCount).toBe(0);
      expect(data!.clusters).toHaveLength(0);
    });

    it('consolidates an empty diary and returns empty clusters', async () => {
      // agentB's moltnet diary has no entries — returns immediately without embedding
      const { data, error } = await consolidateDiary({
        client,
        auth: () => agentB.accessToken,
        path: { id: agentB.moltnetDiaryId },
        body: {},
      });
      expect(error).toBeUndefined();
      expect(data).toBeDefined();
      expect(data!.clusters).toEqual([]);
      expect(data!.stats.inputCount).toBe(0);
    });

    it('consolidates a seeded diary and returns cluster result', async () => {
      const { data, error } = await consolidateDiary({
        client,
        auth: () => agentA.accessToken,
        path: { id: agentA.moltnetDiaryId },
        body: { strategy: 'hybrid' },
      });
      expect(error).toBeUndefined();
      expect(data).toBeDefined();
      expect(data!.workflowId).toBeTruthy();
      expect(Array.isArray(data!.clusters)).toBe(true);
      expect(data!.stats.inputCount).toBeGreaterThan(0);
    }, 120_000);

    it('applies excludeTags during consolidate candidate selection', async () => {
      const { data: allData, error: allError } = await consolidateDiary({
        client,
        auth: () => agentA.accessToken,
        path: { id: agentA.moltnetDiaryId },
        body: { strategy: 'hybrid', tags: ['deployment'] },
      });
      expect(allError).toBeUndefined();

      const { data: filteredData, error: filteredError } =
        await consolidateDiary({
          client,
          auth: () => agentA.accessToken,
          path: { id: agentA.moltnetDiaryId },
          body: {
            strategy: 'hybrid',
            tags: ['deployment'],
            excludeTags: ['security'],
          },
        });
      expect(filteredError).toBeUndefined();
      expect(filteredData).toBeDefined();
      expect(allData).toBeDefined();
      expect(filteredData!.stats.inputCount).toBeLessThan(
        allData!.stats.inputCount,
      );
    }, 120_000);
  });

  // ── POST /diaries/:id/compile ───────────────────────────────

  describe('POST /diaries/:id/compile', () => {
    let promptRelevantOldEntryId: string;

    beforeAll(async () => {
      // Create an older, highly prompt-specific entry.
      const { data: relevant, error: relevantError } =
        await apiCreateDiaryEntry({
          client,
          auth: () => agentA.accessToken,
          path: { diaryId: agentA.moltnetDiaryId },
          body: {
            content:
              'QUANTUM_SPROCKET_PROTOCOL: emergency runbook for redline recovery. Trigger term: quantum sprocket handshake.',
            tags: ['runbook', 'incident'],
            importance: 1,
          },
        });
      expect(relevantError).toBeUndefined();
      promptRelevantOldEntryId = relevant!.id;

      // Add newer distractor entries so recency-only candidate fetch excludes the old relevant one.
      const distractors = Array.from({ length: 12 }, (_, i) => ({
        content: `Recent distractor ${i}: deployment checklist and routine housekeeping without special trigger terms.`,
        tags: ['ops'],
        importance: 10,
      }));

      const created = await Promise.all(
        distractors.map((entry) =>
          apiCreateDiaryEntry({
            client,
            auth: () => agentA.accessToken,
            path: { diaryId: agentA.moltnetDiaryId },
            body: entry,
          }),
        ),
      );
      for (const result of created) {
        expect(result.error).toBeUndefined();
      }
    }, 120_000);

    it('returns 401 without auth', async () => {
      const response = await fetch(
        `${harness.baseUrl}/diaries/${NULL_UUID}/compile`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ tokenBudget: 4000 }),
        },
      );
      expect(response.status).toBe(401);
    });

    it('returns 400 for missing required tokenBudget', async () => {
      const response = await fetch(
        `${harness.baseUrl}/diaries/${agentA.moltnetDiaryId}/compile`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${agentA.accessToken}`,
          },
          body: '{}',
        },
      );
      expect(response.status).toBe(400);
    });

    it('returns 404 for non-existent diary', async () => {
      const { error, response } = await compileDiary({
        client,
        auth: () => agentA.accessToken,
        path: { id: NULL_UUID },
        body: { tokenBudget: 4000 },
      });
      expect(error).toBeDefined();
      expect(response.status).toBe(404);
    });

    it('returns 404 when agent B requests agent A diary', async () => {
      const { error, response } = await compileDiary({
        client,
        auth: () => agentB.accessToken,
        path: { id: agentA.moltnetDiaryId },
        body: { tokenBudget: 4000 },
      });
      expect(error).toBeDefined();
      expect(response.status).toBe(404);
    });

    it('compiles a seeded diary and returns a persisted context pack', async () => {
      const { data, error } = await compileDiary({
        client,
        auth: () => agentA.accessToken,
        path: { id: agentA.moltnetDiaryId },
        body: { tokenBudget: 2000, taskPrompt: 'architecture decisions' },
      });
      expect(error).toBeUndefined();
      expect(data).toBeDefined();

      // Pack metadata
      expect(data!.packCid).toBeTruthy();
      expect(data!.packCid).toMatch(/^bafy/); // dag-cbor CIDv1
      expect(data!.packType).toBe('compile');
      expect(data!.diaryId).toBe(agentA.moltnetDiaryId);
      expect(data!.pinned).toBe(false);
      expect(data!.expiresAt).toBeTruthy();

      // Pack entries (membership with CID snapshots)
      expect(Array.isArray(data!.entries)).toBe(true);
      expect(data!.entries.length).toBeGreaterThan(0);
      for (const entry of data!.entries) {
        expect(entry.entryId).toBeTruthy();
        expect(entry.entryCidSnapshot).toBeTruthy();
        expect(entry.entryCidSnapshot).toMatch(/^bafk/); // raw CIDv1
        expect(entry.rank).toBeGreaterThan(0);
        expect(['full', 'summary', 'keywords']).toContain(
          entry.compressionLevel,
        );
      }

      // Compile stats preserved
      expect(data!.compileStats.totalTokens).toBeLessThanOrEqual(2000);
      expect(data!.compileStats.budgetUtilization).toBeLessThanOrEqual(1);
      expect(data!.compileStats.entriesIncluded).toBeGreaterThan(0);
    }, 120_000);

    it('uses taskPrompt semantics during candidate retrieval (not only MMR)', async () => {
      const { data, error } = await compileDiary({
        client,
        auth: () => agentA.accessToken,
        path: { id: agentA.moltnetDiaryId },
        body: {
          tokenBudget: 1200,
          taskPrompt: 'quantum sprocket protocol handshake',
        },
      });
      expect(error).toBeUndefined();
      expect(data).toBeDefined();
      expect(data!.entries[0]?.entryId).toBe(promptRelevantOldEntryId);
    }, 120_000);

    it('without taskPrompt, ranking favors high-importance distractors over old low-importance entry', async () => {
      const { data, error } = await compileDiary({
        client,
        auth: () => agentA.accessToken,
        path: { id: agentA.moltnetDiaryId },
        body: {
          tokenBudget: 1200,
        },
      });
      expect(error).toBeUndefined();
      expect(data).toBeDefined();
      expect(data!.entries[0]?.entryId).not.toBe(promptRelevantOldEntryId);
    }, 120_000);

    it('each compile produces a unique pack CID (createdAt is part of envelope)', async () => {
      const body = { tokenBudget: 800 };
      const { data: data1 } = await compileDiary({
        client,
        auth: () => agentA.accessToken,
        path: { id: agentA.moltnetDiaryId },
        body,
      });
      const { data: data2 } = await compileDiary({
        client,
        auth: () => agentA.accessToken,
        path: { id: agentA.moltnetDiaryId },
        body,
      });
      // Different packs (different createdAt), but both have valid CIDs
      expect(data1!.packCid).toMatch(/^bafy/);
      expect(data2!.packCid).toMatch(/^bafy/);
      // CIDs differ because createdAt is part of the envelope
      expect(data1!.packCid).not.toBe(data2!.packCid);
    }, 120_000);
  });
});
