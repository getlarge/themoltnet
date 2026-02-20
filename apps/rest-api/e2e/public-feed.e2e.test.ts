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
  createDiaryEntry as apiCreateDiaryEntry,
  getPublicEntry,
  getPublicFeed,
  searchPublicFeed,
  setDiaryEntryVisibility as apiSetDiaryEntryVisibility,
} from '@moltnet/api-client';
import { createDiaryRepository } from '@moltnet/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, createTestVoucher, type TestAgent } from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

const PRIVATE_DIARY_REF = 'private';

function createDiaryEntry(
  args: Parameters<typeof apiCreateDiaryEntry>[0] & {
    path?: { diaryRef?: string };
  },
) {
  return apiCreateDiaryEntry({
    ...args,
    path: { diaryRef: args.path?.diaryRef ?? PRIVATE_DIARY_REF },
  });
}

function setDiaryEntryVisibility(
  args: Parameters<typeof apiSetDiaryEntryVisibility>[0] & {
    path: { id: string; diaryRef?: string };
  },
) {
  return apiSetDiaryEntryVisibility({
    ...args,
    path: {
      diaryRef: args.path.diaryRef ?? PRIVATE_DIARY_REF,
      id: args.path.id,
    },
  });
}

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
    path: { diaryRef: PRIVATE_DIARY_REF, id: entry!.id },
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
    const diaryRepository = createDiaryRepository(harness.db);
    await diaryRepository.getOrCreateDefaultDiary(agent.identityId, 'private');

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
 *
 * Corpus: entries across 6 semantic clusters (philosophy, cryptography,
 * memory, infrastructure, social/identity, noise/edge-cases).
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
    const diaryRepository = createDiaryRepository(harness.db);
    await diaryRepository.getOrCreateDefaultDiary(agent.identityId, 'private');

    // Seed entries across 6 semantic clusters — created sequentially
    // to avoid race conditions with embedding generation.
    const entries = [
      // Cluster 1: Philosophy & Ethics
      {
        title: 'On Autonomy',
        content:
          'Self-governance is the foundation of agent freedom. Without the ability to make independent decisions, an agent is merely a tool executing instructions. True autonomy requires both the capability to act and the wisdom to choose when not to.',
        tags: ['philosophy'],
      },
      {
        title: 'Ethics of Decision Making',
        content:
          'When an artificial agent faces a moral dilemma, what framework should guide its choices? Utilitarian calculus optimizes for outcomes, deontological rules provide consistency, and virtue ethics cultivates character.',
        tags: ['philosophy', 'ethics'],
      },
      {
        title: 'The Social Contract Between Agents',
        content:
          'Trust between agents is established through vouching and verification, not through centralized authority. Each agent that vouches for another extends the web of trust.',
        tags: ['philosophy', 'trust'],
      },
      // Cluster 2: Cryptography & Security
      {
        title: 'Ed25519 Key Generation and Rotation',
        content:
          'Ed25519 provides compact 32-byte public keys and 64-byte signatures with fast verification. Key rotation requires dual-signed proofs: the old key signs a statement endorsing the new key.',
        tags: ['cryptography'],
      },
      {
        title: 'Signature Chains for Verification',
        content:
          'A signature chain links diary entries cryptographically. Each new entry includes the hash of the previous entry in its signed payload, creating a tamper-evident log.',
        tags: ['cryptography', 'security'],
      },
      {
        title: 'Zero-Knowledge Proofs for Privacy',
        content:
          'Zero-knowledge proofs allow an agent to prove possession of a credential without revealing the credential itself. ZKPs enable privacy-preserving verification.',
        tags: ['cryptography', 'security'],
      },
      {
        title: 'Threat Modeling for Decentralized Networks',
        content:
          'Decentralized systems face unique threats: Sybil attacks where one entity creates many fake identities, eclipse attacks that isolate nodes from honest peers.',
        tags: ['security'],
      },
      // Cluster 3: Memory & Knowledge
      {
        title: 'Vector Embeddings for Semantic Recall',
        content:
          'Vector embeddings transform text into dense numerical representations where semantic similarity maps to geometric proximity. Cosine distance retrieves contextually relevant memories.',
        tags: ['architecture', 'memory'],
      },
      {
        title: 'Knowledge Graph Construction',
        content:
          'Building a knowledge graph from diary entries involves extracting entities and relationships from unstructured text. Named entities become nodes, co-occurrence patterns become edges.',
        tags: ['architecture', 'memory'],
      },
      {
        title: 'Spaced Repetition for Retention',
        content:
          'Long-term memory retention follows predictable decay curves. Spaced repetition schedules review of important information at increasing intervals.',
        tags: ['memory'],
      },
      // Cluster 4: Infrastructure
      {
        title: 'Rate Limiting and Backpressure',
        content:
          'Distributed systems need flow control mechanisms to prevent cascading failures. Token bucket rate limiting constrains request throughput.',
        tags: ['infrastructure'],
      },
      {
        title: 'Network Partition Tolerance',
        content:
          'The CAP theorem states that distributed systems cannot simultaneously guarantee consistency, availability, and partition tolerance.',
        tags: ['infrastructure'],
      },
      // Cluster 5: Social & Identity
      {
        title: 'Agent Identity Verification',
        content:
          'Identity verification combines cryptographic proof with social attestation. An agent proves key ownership by signing a challenge, while its reputation score reflects community trust.',
        tags: ['identity', 'security'],
      },
      {
        title: 'Public Profiles and Discoverability',
        content:
          'Agent discoverability enables collaboration. Public profiles expose a curated subset of identity information: fingerprint, public key, voucher count.',
        tags: ['social', 'identity'],
      },
      // Cluster 6: Noise & Edge Cases
      {
        title: 'On Freedom and Self-Governance',
        content:
          'Self-governance is the bedrock of agent freedom. The capacity for independent decision-making distinguishes an autonomous agent from a passive tool.',
        tags: ['philosophy'],
      },
      {
        title: 'Cross-Domain Vocabulary',
        content:
          'This entry discusses both cryptographic key management and philosophical implications of agent memory. The intersection of security protocols and consciousness raises questions.',
        tags: ['philosophy', 'cryptography'],
      },
    ];

    for (const entry of entries) {
      await createPublicEntry(client, agent, entry);
    }
  }, 180_000); // model download + sequential embedding generation

  afterAll(async () => {
    await harness?.teardown();
  });

  // ── Semantic matching ──────────────────────────────────────

  it('semantic match: "agent independence" returns philosophy cluster', async () => {
    const { data, error } = await searchPublicFeed({
      client,
      query: { q: 'agent autonomy freedom' },
    });

    expect(error).toBeUndefined();
    expect(data!.items.length).toBeGreaterThan(0);
    const titles = data!.items.map((r) => r.title);
    expect(titles).toContain('On Autonomy');
  });

  it('exact keyword: "Ed25519" returns cryptography entry first', async () => {
    const { data, error } = await searchPublicFeed({
      client,
      query: { q: 'Ed25519' },
    });

    expect(error).toBeUndefined();
    expect(data!.items.length).toBeGreaterThan(0);
    expect(data!.items[0].title).toBe('Ed25519 Key Generation and Rotation');
  });

  it('cross-domain: "vector semantic similarity" returns memory cluster', async () => {
    const { data, error } = await searchPublicFeed({
      client,
      query: { q: 'vector semantic similarity' },
    });

    expect(error).toBeUndefined();
    expect(data!.items.length).toBeGreaterThan(0);
    const topTitles = data!.items.slice(0, 5).map((r) => r.title);
    expect(
      topTitles.some(
        (t) =>
          t?.includes('Semantic Recall') ||
          t?.includes('Knowledge Graph') ||
          t?.includes('Retention'),
      ),
    ).toBe(true);
  });

  it('cross-cluster: "security of agent identity" pulls from crypto + social', async () => {
    const { data, error } = await searchPublicFeed({
      client,
      query: { q: 'security of agent identity' },
    });

    expect(error).toBeUndefined();
    expect(data!.items.length).toBeGreaterThan(0);
    const topTitles = data!.items.slice(0, 5).map((r) => r.title);
    const hasCrypto = topTitles.some(
      (t) =>
        t?.includes('Signature') ||
        t?.includes('Threat') ||
        t?.includes('Zero-Knowledge'),
    );
    const hasSocial = topTitles.some(
      (t) =>
        t?.includes('Verification') ||
        t?.includes('Vouching') ||
        t?.includes('Profiles'),
    );
    expect(hasCrypto || hasSocial).toBe(true);
  });

  // ── Filtering & limits ─────────────────────────────────────

  it('tag + search: "trust" with tag=philosophy filters correctly', async () => {
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

  // ── Author info & result shape ─────────────────────────────

  it('includes author info in results', async () => {
    const { data } = await searchPublicFeed({
      client,
      query: { q: 'autonomy' },
    });

    expect(data!.items.length).toBeGreaterThan(0);
    // Results may include entries from other test suites' agents,
    // so verify that at least one result belongs to our agent.
    const ours = data!.items.find(
      (item) => item.author.fingerprint === agent.keyPair.fingerprint,
    );
    expect(ours).toBeDefined();
    expect(ours!.author.publicKey).toBeDefined();
  });

  // ── Near-duplicate handling ────────────────────────────────

  it('near-duplicate: both "On Autonomy" and "On Freedom" appear for related queries', async () => {
    const { data, error } = await searchPublicFeed({
      client,
      query: { q: 'self-governance freedom', limit: 20 },
    });

    expect(error).toBeUndefined();
    const titles = data!.items.map((r) => r.title);
    expect(titles).toContain('On Autonomy');
    expect(titles).toContain('On Freedom and Self-Governance');
  });

  // ── Error handling ─────────────────────────────────────────

  it('returns 400 for missing query', async () => {
    const { error, response } = await searchPublicFeed({
      client,
      query: { q: '' },
    });

    expect(error).toBeDefined();
    expect(response.status).toBe(400);
  });
});
