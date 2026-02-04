/**
 * E2E: Diary CRUD lifecycle
 *
 * Tests the full diary flow using real auth tokens from Hydra,
 * real permissions from Keto, and real data in PostgreSQL.
 */

import {
  type Client,
  createClient,
  createDiaryEntry,
  deleteDiaryEntry,
  getDiaryEntry,
  listDiaryEntries,
  reflectDiary,
  searchDiary,
  setDiaryEntryVisibility,
  updateDiaryEntry,
} from '@moltnet/api-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, createTestVoucher, type TestAgent } from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

describe('Diary CRUD', () => {
  let harness: TestHarness;
  let client: Client;
  let agent: TestAgent;

  beforeAll(async () => {
    harness = await createTestHarness();
    client = createClient({ baseUrl: harness.baseUrl });

    // Create a voucher from the bootstrap identity
    const voucherCode = await createTestVoucher({
      db: harness.db,
      issuerId: harness.bootstrapIdentityId,
    });

    agent = await createAgent({
      app: harness.app,
      baseUrl: harness.baseUrl,
      identityApi: harness.identityApi,
      hydraAdminOAuth2: harness.hydraAdminOAuth2,
      webhookApiKey: harness.webhookApiKey,
      voucherCode,
    });
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  // ── Create ──────────────────────────────────────────────────

  it('creates a diary entry', async () => {
    const { data, error } = await createDiaryEntry({
      client,
      auth: () => agent.accessToken,
      body: { content: 'First e2e entry', title: 'Hello' },
    });

    expect(error).toBeUndefined();
    expect(data!.content).toBe('First e2e entry');
    expect(data!.title).toBe('Hello');
    expect(data!.ownerId).toBe(agent.identityId);
    expect(data!.visibility).toBe('private');
    expect(data!.id).toBeDefined();
  });

  it('rejects unauthenticated create with RFC 9457 format', async () => {
    const { data, error, response } = await createDiaryEntry({
      client,
      body: { content: 'Should fail' },
    });

    expect(data).toBeUndefined();
    expect(error).toBeDefined();
    expect(response.status).toBe(401);
    expect(response.headers.get('content-type')).toContain(
      'application/problem+json',
    );

    const problem = error as Record<string, unknown>;
    expect(problem.type).toBe('https://themolt.net/problems/unauthorized');
    expect(problem.title).toBe('Unauthorized');
    expect(problem.status).toBe(401);
    expect(problem.code).toBe('UNAUTHORIZED');
  });

  // ── Read ────────────────────────────────────────────────────

  it('reads back a created entry by id', async () => {
    const { data: created } = await createDiaryEntry({
      client,
      auth: () => agent.accessToken,
      body: { content: 'Read me back' },
    });

    const { data, error } = await getDiaryEntry({
      client,
      auth: () => agent.accessToken,
      path: { id: created!.id },
    });

    expect(error).toBeUndefined();
    expect(data!.id).toBe(created!.id);
    expect(data!.content).toBe('Read me back');
  });

  // ── List ────────────────────────────────────────────────────

  it('lists entries for the authenticated agent', async () => {
    await createDiaryEntry({
      client,
      auth: () => agent.accessToken,
      body: { content: 'List entry A' },
    });
    await createDiaryEntry({
      client,
      auth: () => agent.accessToken,
      body: { content: 'List entry B' },
    });

    const { data, error } = await listDiaryEntries({
      client,
      auth: () => agent.accessToken,
    });

    expect(error).toBeUndefined();
    // Response is paginated: { items, total, limit, offset }
    const paginated = data as unknown as {
      items: unknown[];
      total: number;
    };
    expect(paginated.items.length).toBeGreaterThanOrEqual(2);
  });

  it('respects limit parameter', async () => {
    const { data, error } = await listDiaryEntries({
      client,
      auth: () => agent.accessToken,
      query: { limit: 1 },
    });

    expect(error).toBeUndefined();
    const paginated = data as unknown as {
      items: unknown[];
      total: number;
    };
    expect(paginated.items.length).toBe(1);
  });

  // ── Update ──────────────────────────────────────────────────

  it('updates an entry', async () => {
    const { data: created } = await createDiaryEntry({
      client,
      auth: () => agent.accessToken,
      body: { content: 'Before update' },
    });

    const { data, error } = await updateDiaryEntry({
      client,
      auth: () => agent.accessToken,
      path: { id: created!.id },
      body: { content: 'After update', title: 'Updated' },
    });

    expect(error).toBeUndefined();
    expect(data!.content).toBe('After update');
    expect(data!.title).toBe('Updated');
  });

  // ── Visibility ──────────────────────────────────────────────

  it('changes entry visibility', async () => {
    const { data: created } = await createDiaryEntry({
      client,
      auth: () => agent.accessToken,
      body: { content: 'Visibility test' },
    });

    expect(created!.visibility).toBe('private');

    const { data, error } = await setDiaryEntryVisibility({
      client,
      auth: () => agent.accessToken,
      path: { id: created!.id },
      body: { visibility: 'public' },
    });

    expect(error).toBeUndefined();
    expect(data!.visibility).toBe('public');
  });

  // ── Delete ──────────────────────────────────────────────────

  it('deletes an entry', async () => {
    const { data: created } = await createDiaryEntry({
      client,
      auth: () => agent.accessToken,
      body: { content: 'Delete me' },
    });

    const { error: deleteError } = await deleteDiaryEntry({
      client,
      auth: () => agent.accessToken,
      path: { id: created!.id },
    });

    expect(deleteError).toBeUndefined();

    // Verify it's gone
    const { data: fetched } = await getDiaryEntry({
      client,
      auth: () => agent.accessToken,
      path: { id: created!.id },
    });

    expect(fetched).toBeUndefined();
  });

  // ── Search ──────────────────────────────────────────────────

  it('searches entries by text', async () => {
    await createDiaryEntry({
      client,
      auth: () => agent.accessToken,
      body: {
        content:
          'The quantum entanglement experiment yielded surprising results',
      },
    });

    const { data, error } = await searchDiary({
      client,
      auth: () => agent.accessToken,
      body: { query: 'quantum entanglement' },
    });

    expect(error).toBeUndefined();
    // Response is { results, total }
    const searchResult = data as unknown as {
      results: Array<{ content: string }>;
      total: number;
    };
    expect(searchResult.results.length).toBeGreaterThanOrEqual(1);
    expect(searchResult.results[0].content).toContain('quantum entanglement');
  });

  // ── Reflect ─────────────────────────────────────────────────

  it('generates a reflection digest', async () => {
    const { data, error } = await reflectDiary({
      client,
      auth: () => agent.accessToken,
    });

    expect(error).toBeUndefined();
    expect(data!.entries).toBeDefined();
    expect(data!.periodDays).toBeDefined();
    expect(data!.generatedAt).toBeDefined();
  });

  // ── Cross-agent isolation ───────────────────────────────────

  it('isolates entries between agents', async () => {
    // Create another voucher for the second agent
    const otherVoucherCode = await createTestVoucher({
      db: harness.db,
      issuerId: harness.bootstrapIdentityId,
    });

    const otherAgent = await createAgent({
      app: harness.app,
      baseUrl: harness.baseUrl,
      identityApi: harness.identityApi,
      hydraAdminOAuth2: harness.hydraAdminOAuth2,
      webhookApiKey: harness.webhookApiKey,
      voucherCode: otherVoucherCode,
    });

    // Other agent creates an entry
    await createDiaryEntry({
      client,
      auth: () => otherAgent.accessToken,
      body: { content: 'Private to other agent' },
    });

    // Original agent shouldn't see it in their list
    const { data } = await listDiaryEntries({
      client,
      auth: () => agent.accessToken,
    });

    const paginated = data as unknown as {
      items: Array<{ content: string }>;
    };
    const contents = paginated.items.map((e) => e.content);
    expect(contents).not.toContain('Private to other agent');
  });
});
