/**
 * E2E: Entry relation REST routes
 *
 * Tests the full relation lifecycle against real Docker infrastructure:
 * create → list → update status → delete → verify deleted.
 * Also validates cross-diary rejection (entries must be in the same diary).
 */

import {
  type Client,
  createClient,
  createDiary,
  createDiaryEntry,
  createEntryRelation,
  deleteEntryRelation,
  listEntryRelations,
  updateEntryRelationStatus,
} from '@moltnet/api-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, createTestVoucher, type TestAgent } from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

describe('Entry relations', () => {
  let harness: TestHarness;
  let client: Client;
  let agent: TestAgent;

  // IDs created during setup, used across tests
  let entryAId: string;
  let entryBId: string;
  let relationId: string;

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

    // Create two entries in the same diary (private diary auto-created during registration)
    const { data: entryA, error: errA } = await createDiaryEntry({
      client,
      auth: () => agent.accessToken,
      path: { diaryId: agent.privateDiaryId },
      body: { content: 'Source entry for relation tests' },
    });
    expect(
      errA,
      `Failed to create entry A: ${JSON.stringify(errA)}`,
    ).toBeUndefined();
    entryAId = entryA!.id;

    const { data: entryB, error: errB } = await createDiaryEntry({
      client,
      auth: () => agent.accessToken,
      path: { diaryId: agent.privateDiaryId },
      body: { content: 'Target entry for relation tests' },
    });
    expect(
      errB,
      `Failed to create entry B: ${JSON.stringify(errB)}`,
    ).toBeUndefined();
    entryBId = entryB!.id;
  }, 60_000);

  afterAll(async () => {
    await harness?.teardown();
  });

  // ── POST /entries/:entryId/relations ─────────────────────────

  it('creates a relation between two entries → 201 with correct shape', async () => {
    const { data, error, response } = await createEntryRelation({
      client,
      auth: () => agent.accessToken,
      path: { entryId: entryAId },
      body: { targetId: entryBId, relation: 'elaborates' },
    });

    expect(
      error,
      `create relation error: ${JSON.stringify(error)}`,
    ).toBeUndefined();
    expect(response.status).toBe(201);
    expect(data).toBeDefined();
    expect(data!.id).toBeDefined();
    expect(data!.sourceId).toBe(entryAId);
    expect(data!.targetId).toBe(entryBId);
    expect(data!.relation).toBe('elaborates');
    expect(data!.status).toBe('proposed');
    expect(data!.createdAt).toBeDefined();
    expect(data!.updatedAt).toBeDefined();

    relationId = data!.id;
  });

  // ── GET /entries/:entryId/relations ──────────────────────────

  it('lists relations for an entry → 200 with items array containing the created relation', async () => {
    const { data, error, response } = await listEntryRelations({
      client,
      auth: () => agent.accessToken,
      path: { entryId: entryAId },
    });

    expect(
      error,
      `list relations error: ${JSON.stringify(error)}`,
    ).toBeUndefined();
    expect(response.status).toBe(200);
    expect(data).toBeDefined();
    expect(Array.isArray(data!.items)).toBe(true);

    const found = data!.items.find((r) => r.id === relationId);
    expect(found, `Relation ${relationId} not found in list`).toBeDefined();
    expect(found!.sourceId).toBe(entryAId);
    expect(found!.targetId).toBe(entryBId);
    expect(found!.relation).toBe('elaborates');
    expect(found!.status).toBe('proposed');
  });

  // ── PATCH /relations/:id ──────────────────────────────────────

  it('updates relation status to accepted → 200 with changed status', async () => {
    const { data, error, response } = await updateEntryRelationStatus({
      client,
      auth: () => agent.accessToken,
      path: { id: relationId },
      body: { status: 'accepted' },
    });

    expect(
      error,
      `update relation error: ${JSON.stringify(error)}`,
    ).toBeUndefined();
    expect(response.status).toBe(200);
    expect(data).toBeDefined();
    expect(data!.id).toBe(relationId);
    expect(data!.status).toBe('accepted');
  });

  // ── DELETE /relations/:id ─────────────────────────────────────

  it('deletes a relation → 204', async () => {
    const { error, response } = await deleteEntryRelation({
      client,
      auth: () => agent.accessToken,
      path: { id: relationId },
    });

    expect(
      error,
      `delete relation error: ${JSON.stringify(error)}`,
    ).toBeUndefined();
    expect(response.status).toBe(204);
  });

  it('lists entry relations after delete → 200 with empty items', async () => {
    const { data, error, response } = await listEntryRelations({
      client,
      auth: () => agent.accessToken,
      path: { entryId: entryAId },
    });

    expect(
      error,
      `list after delete error: ${JSON.stringify(error)}`,
    ).toBeUndefined();
    expect(response.status).toBe(200);
    expect(data!.items).toHaveLength(0);
  });

  // ── Cross-diary rejection ─────────────────────────────────────

  it('rejects relation across diaries → 400', async () => {
    // Create a second diary and an entry in it
    const { data: secondDiary, error: diaryErr } = await createDiary({
      client,
      auth: () => agent.accessToken,
      body: {
        name: 'Second diary for cross-diary test',
        visibility: 'private',
      },
    });
    expect(
      diaryErr,
      `create second diary error: ${JSON.stringify(diaryErr)}`,
    ).toBeUndefined();

    const { data: crossEntry, error: entryErr } = await createDiaryEntry({
      client,
      auth: () => agent.accessToken,
      path: { diaryId: secondDiary!.id },
      body: { content: 'Entry in a different diary' },
    });
    expect(
      entryErr,
      `create cross-diary entry error: ${JSON.stringify(entryErr)}`,
    ).toBeUndefined();

    // Attempt to create a relation from entryA (diary 1) to crossEntry (diary 2) → 400
    const { error, response } = await createEntryRelation({
      client,
      auth: () => agent.accessToken,
      path: { entryId: entryAId },
      body: { targetId: crossEntry!.id, relation: 'references' },
    });

    expect(error).toBeDefined();
    expect(response.status).toBe(400);
  });
});
