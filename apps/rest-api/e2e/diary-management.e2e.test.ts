/**
 * E2E: Diary Management + Keto Permissions
 *
 * Tests diary CRUD and Keto permission wiring.
 * Sharing was removed in Option B — access is now team-based.
 */

import {
  type Client,
  createClient,
  createDiary,
  createDiaryEntry,
  deleteDiary,
  listDiaries,
  listDiaryEntries,
  updateDiary,
} from '@moltnet/api-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, type TestAgent } from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

describe('Diary Management', () => {
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
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  /** auth shorthand */
  const authA = () => agentA.accessToken;
  const authB = () => agentB.accessToken;

  // ── Helpers ─────────────────────────────────────────────────

  async function createTestDiary(
    name: string,
    visibility = 'private' as const,
  ) {
    const { data, error } = await createDiary({
      client,
      auth: authA,
      body: { name, visibility },
      headers: { 'x-moltnet-team-id': agentA.personalTeamId },
    });
    expect(error).toBeUndefined();
    return data!;
  }

  // ── Diary CRUD ──────────────────────────────────────────────

  describe('Diary CRUD', () => {
    it('creates a custom diary', async () => {
      const { data, error } = await createDiary({
        client,
        auth: authA,
        body: { name: 'Work Notes', visibility: 'private' },
        headers: { 'x-moltnet-team-id': agentA.personalTeamId },
      });

      expect(error).toBeUndefined();
      expect(data!.name).toBe('Work Notes');
      expect(data!.visibility).toBe('private');
      expect(data!.createdBy).toBe(agentA.identityId);
      expect(data!.id).toBeDefined();
    });

    it('lists diaries for the authenticated agent', async () => {
      const { data, error } = await listDiaries({
        client,
        auth: authA,
      });

      expect(error).toBeUndefined();
      const names = data!.items.map((d) => d.name);
      expect(names).toContain('Private');
      expect(names).toContain('Work Notes');
    });

    it('updates diary name', async () => {
      const { data: listData } = await listDiaries({ client, auth: authA });
      const diary = listData!.items.find((d) => d.name === 'Work Notes');

      const { data, error } = await updateDiary({
        client,
        auth: authA,
        path: { id: diary!.id },
        body: { name: 'Work Notes Updated' },
      });

      expect(error).toBeUndefined();
      expect(data!.name).toBe('Work Notes Updated');
    });

    it('deletes a custom diary and cascades entries', async () => {
      const diary = await createTestDiary('temp-diary');

      await createDiaryEntry({
        client,
        auth: authA,
        path: { diaryId: diary.id },
        body: { content: 'Entry in temp diary' },
      });

      const { error: deleteError } = await deleteDiary({
        client,
        auth: authA,
        path: { id: diary.id },
      });
      expect(deleteError).toBeUndefined();

      const { error } = await listDiaryEntries({
        client,
        auth: authA,
        path: { diaryId: diary.id },
      });
      expect(error).toBeDefined();
    });

    it('rejects unauthenticated diary creation', async () => {
      const { error, response } = await createDiary({
        client,
        body: { name: 'no-auth' },
      });

      expect(error).toBeDefined();
      // Schema validation (required x-moltnet-team-id header) fires before
      // the auth preHandler hook, so this returns 400 rather than 401.
      expect(response.status).toBe(400);
    });
  });

  // ── Keto Diary Permissions ──────────────────────────────────

  describe('Keto diary permissions', () => {
    let ketoDiaryId: string;

    beforeAll(async () => {
      const diary = await createTestDiary('keto-test-diary');
      ketoDiaryId = diary.id;
    });

    it('owner can create entries via Keto write permission', async () => {
      const { data, error } = await createDiaryEntry({
        client,
        auth: authA,
        path: { diaryId: ketoDiaryId },
        body: { content: 'Entry via Keto owner write' },
      });

      expect(error).toBeUndefined();
      expect(data!.content).toBe('Entry via Keto owner write');
    });

    it('denies cross-agent diary access without team membership', async () => {
      const { error, response } = await listDiaryEntries({
        client,
        auth: authB,
        path: { diaryId: ketoDiaryId },
      });

      expect(error).toBeDefined();
      expect(response.status).toBe(404);
    });

    it('denies cross-agent entry creation in unshared diary', async () => {
      const { error, response } = await createDiaryEntry({
        client,
        auth: authB,
        path: { diaryId: ketoDiaryId },
        body: { content: 'Should not be created' },
      });

      expect(error).toBeDefined();
      expect(response.status).toBe(403);
    });
  });

  // ── Unauthorized access (no token) ─────────────────────────

  describe('Unauthorized access (no token)', () => {
    it('POST /diaries → 400 (schema rejects missing team header before auth)', async () => {
      const response = await fetch(`${harness.baseUrl}/diaries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'no-auth' }),
      });

      // Schema validation (required x-moltnet-team-id header) fires before
      // the auth preHandler hook, so this returns 400 rather than 401.
      expect(response.status).toBe(400);
    });

    it('GET /diaries → 401', async () => {
      const response = await fetch(`${harness.baseUrl}/diaries`);

      expect(response.status).toBe(401);
    });

    it('GET /diaries/:id → 401', async () => {
      const response = await fetch(
        `${harness.baseUrl}/diaries/00000000-0000-0000-0000-000000000000`,
      );

      expect(response.status).toBe(401);
    });

    it('PATCH /diaries/:id → 401', async () => {
      const response = await fetch(
        `${harness.baseUrl}/diaries/00000000-0000-0000-0000-000000000000`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'no-auth patch' }),
        },
      );

      expect(response.status).toBe(401);
    });

    it('DELETE /diaries/:id → 401', async () => {
      const response = await fetch(
        `${harness.baseUrl}/diaries/${agentA.privateDiaryId}`,
        { method: 'DELETE' },
      );

      expect(response.status).toBe(401);
    });
  });
});
