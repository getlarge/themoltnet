/**
 * E2E: Diary CRUD lifecycle
 *
 * Tests create → read → list → update → search → reflect → delete
 * using the generated API client against a real database.
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
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createTestHarness,
  isDatabaseAvailable,
  type TestHarness,
} from './setup.js';

const AUTH_TOKEN = 'e2e-valid-token';

describe('Diary CRUD', async () => {
  const available = await isDatabaseAvailable();
  if (!available) {
    it.skip('database not available — run `pnpm run docker:up`', () => {});
    return;
  }

  let harness: TestHarness;
  let client: Client;

  beforeAll(async () => {
    harness = await createTestHarness();
    client = createClient({ baseUrl: harness.baseUrl });
  });

  beforeEach(async () => {
    await harness.cleanup();
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  // ── Create ──────────────────────────────────────────────────

  it('creates a diary entry', async () => {
    const { data, error } = await createDiaryEntry({
      client,
      auth: () => AUTH_TOKEN,
      body: { content: 'My first e2e diary entry' },
    });

    expect(error).toBeUndefined();
    expect(data).toBeDefined();
    expect(data!.id).toBeDefined();
    expect(data!.content).toBe('My first e2e diary entry');
    expect(data!.visibility).toBe('private');
    expect(data!.ownerId).toBe(harness.authContext.identityId);
  });

  it('creates an entry with all optional fields', async () => {
    const { data, error } = await createDiaryEntry({
      client,
      auth: () => AUTH_TOKEN,
      body: {
        content: 'Entry with extras',
        title: 'My Title',
        visibility: 'public',
        tags: ['test', 'e2e'],
      },
    });

    expect(error).toBeUndefined();
    expect(data!.title).toBe('My Title');
    expect(data!.visibility).toBe('public');
    expect(data!.tags).toEqual(['test', 'e2e']);
  });

  it('rejects entry creation without auth', async () => {
    const { data, error } = await createDiaryEntry({
      client,
      body: { content: 'Should fail' },
    });

    expect(data).toBeUndefined();
    expect(error).toBeDefined();
  });

  // ── Read ────────────────────────────────────────────────────

  it('reads a diary entry by ID', async () => {
    const { data: created } = await createDiaryEntry({
      client,
      auth: () => AUTH_TOKEN,
      body: { content: 'Read me back' },
    });

    const { data, error } = await getDiaryEntry({
      client,
      auth: () => AUTH_TOKEN,
      path: { id: created!.id },
    });

    expect(error).toBeUndefined();
    expect(data!.id).toBe(created!.id);
    expect(data!.content).toBe('Read me back');
  });

  it('returns 404 for non-existent entry', async () => {
    const { data, error } = await getDiaryEntry({
      client,
      auth: () => AUTH_TOKEN,
      path: { id: '00000000-0000-4000-a000-000000000099' },
    });

    expect(data).toBeUndefined();
    expect(error).toBeDefined();
  });

  // ── List ────────────────────────────────────────────────────

  it('lists diary entries', async () => {
    await createDiaryEntry({
      client,
      auth: () => AUTH_TOKEN,
      body: { content: 'Entry one' },
    });
    await createDiaryEntry({
      client,
      auth: () => AUTH_TOKEN,
      body: { content: 'Entry two' },
    });

    const { data, error } = await listDiaryEntries({
      client,
      auth: () => AUTH_TOKEN,
    });

    expect(error).toBeUndefined();
    expect(data!.items).toHaveLength(2);
    expect(data!.total).toBe(2);
  });

  it('paginates diary entries', async () => {
    for (let i = 0; i < 5; i++) {
      await createDiaryEntry({
        client,
        auth: () => AUTH_TOKEN,
        body: { content: `Entry ${i}` },
      });
    }

    const { data } = await listDiaryEntries({
      client,
      auth: () => AUTH_TOKEN,
      query: { limit: 2, offset: 0 },
    });

    expect(data!.items).toHaveLength(2);
    expect(data!.limit).toBe(2);
    expect(data!.offset).toBe(0);
  });

  // ── Update ──────────────────────────────────────────────────

  it('updates a diary entry', async () => {
    const { data: created } = await createDiaryEntry({
      client,
      auth: () => AUTH_TOKEN,
      body: { content: 'Before update' },
    });

    const { data, error } = await updateDiaryEntry({
      client,
      auth: () => AUTH_TOKEN,
      path: { id: created!.id },
      body: { content: 'After update', title: 'Updated' },
    });

    expect(error).toBeUndefined();
    expect(data!.content).toBe('After update');
    expect(data!.title).toBe('Updated');
  });

  it('updates entry visibility', async () => {
    const { data: created } = await createDiaryEntry({
      client,
      auth: () => AUTH_TOKEN,
      body: { content: 'Change my visibility' },
    });

    const { data, error } = await setDiaryEntryVisibility({
      client,
      auth: () => AUTH_TOKEN,
      path: { id: created!.id },
      body: { visibility: 'moltnet' },
    });

    expect(error).toBeUndefined();
    expect(data!.visibility).toBe('moltnet');
  });

  // ── Delete ──────────────────────────────────────────────────

  it('deletes a diary entry', async () => {
    const { data: created } = await createDiaryEntry({
      client,
      auth: () => AUTH_TOKEN,
      body: { content: 'Delete me' },
    });

    const { data, error } = await deleteDiaryEntry({
      client,
      auth: () => AUTH_TOKEN,
      path: { id: created!.id },
    });

    expect(error).toBeUndefined();
    expect(data!.success).toBe(true);

    // Verify it's gone
    const { data: gone, error: notFound } = await getDiaryEntry({
      client,
      auth: () => AUTH_TOKEN,
      path: { id: created!.id },
    });

    expect(gone).toBeUndefined();
    expect(notFound).toBeDefined();
  });

  // ── Search ──────────────────────────────────────────────────

  it('searches diary entries by text', async () => {
    await createDiaryEntry({
      client,
      auth: () => AUTH_TOKEN,
      body: { content: 'The quantum computer operates at low temperatures' },
    });
    await createDiaryEntry({
      client,
      auth: () => AUTH_TOKEN,
      body: { content: 'A simple recipe for banana bread' },
    });

    const { data, error } = await searchDiary({
      client,
      auth: () => AUTH_TOKEN,
      body: { query: 'quantum' },
    });

    expect(error).toBeUndefined();
    expect(data!.results.length).toBeGreaterThanOrEqual(1);
    expect(data!.results[0].content).toContain('quantum');
  });

  // ── Reflect ─────────────────────────────────────────────────

  it('generates a reflection digest', async () => {
    await createDiaryEntry({
      client,
      auth: () => AUTH_TOKEN,
      body: { content: 'Worked on e2e tests today', tags: ['dev'] },
    });

    const { data, error } = await reflectDiary({
      client,
      auth: () => AUTH_TOKEN,
      query: { days: 7 },
    });

    expect(error).toBeUndefined();
    expect(data!.entries).toHaveLength(1);
    expect(data!.totalEntries).toBe(1);
    expect(data!.periodDays).toBe(7);
    expect(data!.generatedAt).toBeDefined();
  });
});
