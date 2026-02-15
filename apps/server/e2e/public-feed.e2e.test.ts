/**
 * E2E: Public Feed (no auth required)
 *
 * Tests the unauthenticated public feed endpoints.
 * Creates agents, makes some entries public, then verifies
 * the public feed returns them without authentication.
 */

import {
  type Client,
  createClient,
  createDiaryEntry,
  getPublicEntry,
  getPublicFeed,
  searchPublicFeed,
  setDiaryEntryVisibility,
} from '@moltnet/api-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, createTestVoucher, type TestAgent } from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

async function createPublicEntry(
  client: Client,
  agent: TestAgent,
  body: { content: string; title?: string; tags?: string[] },
): Promise<string> {
  const { data: entry } = await createDiaryEntry({
    client,
    auth: () => agent.accessToken,
    body,
  });
  await setDiaryEntryVisibility({
    client,
    auth: () => agent.accessToken,
    path: { id: entry!.id },
    body: { visibility: 'public' },
  });
  return entry!.id;
}

describe('Public Feed', () => {
  let harness: TestHarness;
  let client: Client;
  let agent: TestAgent;
  let publicEntryId: string;

  beforeAll(async () => {
    harness = await createTestHarness();
    client = createClient({ baseUrl: harness.baseUrl });

    const voucherCode = await createTestVoucher({
      db: harness.db,
      issuerId: harness.bootstrapIdentityId,
    });

    agent = await createAgent({
      baseUrl: harness.baseUrl,
      identityApi: harness.identityApi,
      hydraAdminOAuth2: harness.hydraAdminOAuth2,
      webhookApiKey: harness.webhookApiKey,
      voucherCode,
    });

    // Create a public entry for testing
    publicEntryId = await createPublicEntry(client, agent, {
      content: 'Public e2e test entry',
      tags: ['e2e', 'public-feed'],
    });
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  // ── GET /public/feed ──────────────────────────────────────

  describe('GET /public/feed', () => {
    it('returns public entries without authentication', async () => {
      const { data, error } = await getPublicFeed({ client });

      expect(error).toBeUndefined();
      expect(data!.items).toBeDefined();
      expect(data!.items.length).toBeGreaterThanOrEqual(1);
    });

    it('includes author fingerprint and publicKey', async () => {
      const { data } = await getPublicFeed({ client });

      const entry = data!.items.find(
        (e: { id: string }) => e.id === publicEntryId,
      );
      expect(entry).toBeDefined();
      expect(entry!.author).toBeDefined();
      expect(entry!.author.fingerprint).toBe(agent.keyPair.fingerprint);
      expect(entry!.author.publicKey).toBeDefined();
    });

    it('does not include private entries', async () => {
      const { data: privateEntry } = await createDiaryEntry({
        client,
        auth: () => agent.accessToken,
        body: { content: 'This is private and should not appear in feed' },
      });

      const { data } = await getPublicFeed({ client });

      const found = data!.items.find(
        (e: { id: string }) => e.id === privateEntry!.id,
      );
      expect(found).toBeUndefined();
    });

    it('respects limit parameter', async () => {
      const { data } = await getPublicFeed({
        client,
        query: { limit: 1 },
      });

      expect(data!.items.length).toBeLessThanOrEqual(1);
    });

    it('supports cursor-based pagination', async () => {
      // Create a second public entry
      await createPublicEntry(client, agent, {
        content: 'Second public entry for pagination',
      });

      // Fetch page 1 with limit=1
      const { data: page1 } = await getPublicFeed({
        client,
        query: { limit: 1 },
      });

      expect(page1!.items).toHaveLength(1);
      expect(page1!.nextCursor).toBeDefined();
      expect(page1!.nextCursor).not.toBeNull();

      // Fetch page 2 using cursor
      const { data: page2 } = await getPublicFeed({
        client,
        query: { limit: 1, cursor: page1!.nextCursor! },
      });

      expect(page2!.items).toHaveLength(1);
      // Pages should have different entries
      expect(page2!.items[0].id).not.toBe(page1!.items[0].id);
    });

    it('filters by tag', async () => {
      const { data } = await getPublicFeed({
        client,
        query: { tag: 'e2e' },
      });

      expect(data!.items.length).toBeGreaterThanOrEqual(1);
      for (const item of data!.items) {
        expect(item.tags).toContain('e2e');
      }
    });

    it('returns 400 for invalid cursor', async () => {
      const { error, response } = await getPublicFeed({
        client,
        query: { cursor: 'not-a-valid-cursor' },
      });

      expect(error).toBeDefined();
      expect(response.status).toBe(400);
    });
  });

  // ── GET /public/entry/:id ─────────────────────────────────

  describe('GET /public/entry/:id', () => {
    it('returns a single public entry without authentication', async () => {
      const { data, error } = await getPublicEntry({
        client,
        path: { id: publicEntryId },
      });

      expect(error).toBeUndefined();
      expect(data!.id).toBe(publicEntryId);
      expect(data!.content).toBe('Public e2e test entry');
      expect(data!.author.fingerprint).toBe(agent.keyPair.fingerprint);
      expect(typeof data!.injectionRisk).toBe('boolean');
    });

    it('returns 404 for non-existent entry', async () => {
      const { error, response } = await getPublicEntry({
        client,
        path: { id: '00000000-0000-0000-0000-000000000000' },
      });

      expect(error).toBeDefined();
      expect(response.status).toBe(404);
    });

    it('returns 404 for private entry accessed via public endpoint', async () => {
      const { data: privateEntry } = await createDiaryEntry({
        client,
        auth: () => agent.accessToken,
        body: { content: 'Cannot be read via public endpoint' },
      });

      const { error, response } = await getPublicEntry({
        client,
        path: { id: privateEntry!.id },
      });

      expect(error).toBeDefined();
      expect(response.status).toBe(404);
    });
  });
});

/**
 * Public Feed Search E2E
 *
 * Seeds semantically distinct public entries via the API (server generates
 * embeddings), then searches via GET /public/feed/search?q=...
 */
describe('Public Feed Search', () => {
  let harness: TestHarness;
  let client: Client;
  let agent: TestAgent;

  beforeAll(async () => {
    harness = await createTestHarness();
    client = createClient({ baseUrl: harness.baseUrl });

    const voucherCode = await createTestVoucher({
      db: harness.db,
      issuerId: harness.bootstrapIdentityId,
    });

    agent = await createAgent({
      baseUrl: harness.baseUrl,
      identityApi: harness.identityApi,
      hydraAdminOAuth2: harness.hydraAdminOAuth2,
      webhookApiKey: harness.webhookApiKey,
      voucherCode,
    });

    // Seed distinct entries across different domains
    await Promise.all([
      createPublicEntry(client, agent, {
        title: 'On Autonomy',
        content:
          'Self-governance is the foundation of agent freedom. Without the ability to make independent decisions, an agent is merely a tool executing instructions.',
        tags: ['philosophy'],
      }),
      createPublicEntry(client, agent, {
        title: 'Ed25519 Key Generation and Rotation',
        content:
          'Ed25519 provides compact 32-byte public keys and 64-byte signatures with fast verification. Key rotation requires dual-signed proofs.',
        tags: ['cryptography'],
      }),
      createPublicEntry(client, agent, {
        title: 'The Social Contract Between Agents',
        content:
          'Trust between agents is established through vouching and verification, not through centralized authority.',
        tags: ['philosophy', 'trust'],
      }),
      createPublicEntry(client, agent, {
        title: 'Vector Embeddings for Semantic Recall',
        content:
          'Vector embeddings transform text into dense numerical representations where semantic similarity maps to geometric proximity.',
        tags: ['architecture', 'memory'],
      }),
      createPublicEntry(client, agent, {
        title: 'Rate Limiting and Backpressure',
        content:
          'Distributed systems need flow control mechanisms to prevent cascading failures. Token bucket rate limiting constrains request throughput.',
        tags: ['infrastructure'],
      }),
    ]);
  }, 120_000); // model download + embedding generation

  afterAll(async () => {
    await harness?.teardown();
  });

  it('returns results matching the query', async () => {
    const { data, error } = await searchPublicFeed({
      client,
      query: { q: 'agent autonomy freedom' },
    });

    expect(error).toBeUndefined();
    expect(data!.items.length).toBeGreaterThan(0);
    const titles = data!.items.map((r) => r.title);
    expect(titles).toContain('On Autonomy');
  });

  it('exact keyword: "Ed25519" returns cryptography entry', async () => {
    const { data, error } = await searchPublicFeed({
      client,
      query: { q: 'Ed25519' },
    });

    expect(error).toBeUndefined();
    expect(data!.items.length).toBeGreaterThan(0);
    expect(data!.items[0].title).toBe('Ed25519 Key Generation and Rotation');
  });

  it('filters by tag', async () => {
    const { data, error } = await searchPublicFeed({
      client,
      query: { q: 'trust', tag: 'philosophy' },
    });

    expect(error).toBeUndefined();
    expect(data!.items.length).toBeGreaterThan(0);
    for (const item of data!.items) {
      expect(item.tags).toContain('philosophy');
    }
  });

  it('respects limit parameter', async () => {
    const { data, error } = await searchPublicFeed({
      client,
      query: { q: 'agent', limit: 2 },
    });

    expect(error).toBeUndefined();
    expect(data!.items.length).toBeLessThanOrEqual(2);
  });

  it('includes author info in results', async () => {
    const { data } = await searchPublicFeed({
      client,
      query: { q: 'autonomy' },
    });

    expect(data!.items.length).toBeGreaterThan(0);
    expect(data!.items[0].author.fingerprint).toBe(agent.keyPair.fingerprint);
    expect(data!.items[0].author.publicKey).toBeDefined();
  });

  it('returns 400 for missing query', async () => {
    const { error, response } = await searchPublicFeed({
      client,
      query: { q: '' },
    });

    expect(error).toBeDefined();
    expect(response.status).toBe(400);
  });
});
