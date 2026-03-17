/**
 * E2E: Content-signed immutable diary entries
 *
 * Tests the full content signing lifecycle: compute CID → sign →
 * create signed entry → verify → attempt update → 409.
 * Uses real auth, real DBOS workflows, and real crypto.
 */

import {
  type Client,
  createClient,
  createDiaryEntry,
  createSigningRequest,
  getDiaryEntryById,
  submitSignature,
  updateDiaryEntryById,
  verifyDiaryEntryById,
} from '@moltnet/api-client';
import { computeContentCid, cryptoService } from '@moltnet/crypto-service';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, createTestVoucher, type TestAgent } from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

describe('Content-signed entries', () => {
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
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  // ── Full signing round-trip ──────────────────────────────────

  it('creates a signed entry and verifies it', async () => {
    const content = 'This entry is immutable once signed';
    const title = 'Signed Test';
    const entryType = 'semantic';
    const tags = ['test', 'signing'];

    // 1. Compute CID locally
    const contentCid = computeContentCid(entryType, title, content, tags);
    expect(contentCid).toMatch(/^b/); // base32 CID starts with 'b'

    // 2. Create signing request with CID as message
    const { data: signingRequest } = await createSigningRequest({
      client,
      auth: () => agent.accessToken,
      body: { message: contentCid },
    });
    expect(signingRequest!.status).toBe('pending');

    // 3. Sign locally
    const signature = await cryptoService.signWithNonce(
      contentCid,
      signingRequest!.nonce,
      agent.keyPair.privateKey,
    );

    // 4. Submit signature
    const { data: submitted } = await submitSignature({
      client,
      auth: () => agent.accessToken,
      path: { id: signingRequest!.id },
      body: { signature },
    });
    expect(submitted!.status).toBe('completed');
    expect(submitted!.valid).toBe(true);

    // 5. Create signed entry
    const { data: entry, error: createError } = await createDiaryEntry({
      client,
      auth: () => agent.accessToken,
      path: { diaryId: agent.privateDiaryId },
      body: {
        content,
        title,
        entryType,
        tags,
        contentHash: contentCid,
        signingRequestId: signingRequest!.id,
      },
    });

    expect(createError).toBeUndefined();
    expect(entry!.contentHash).toBe(contentCid);
    expect(entry!.contentSignature).toBe(signature);

    // 6. Verify the entry
    const { data: verification, error: verifyError } =
      await verifyDiaryEntryById({
        client,
        auth: () => agent.accessToken,
        path: { entryId: entry!.id },
      });

    expect(verifyError).toBeUndefined();
    expect(verification!.signed).toBe(true);
    expect(verification!.hashMatches).toBe(true);
    expect(verification!.signatureValid).toBe(true);
    expect(verification!.valid).toBe(true);
    expect(verification!.contentHash).toBe(contentCid);
    expect(verification!.agentFingerprint).toBeDefined();
  });

  // ── Simplified flow: signingRequestId only ───────────────────

  it('creates a signed entry with signingRequestId only (server computes CID)', async () => {
    const content = 'Server-computed CID test';
    const title = 'Simplified flow';
    const entryType = 'procedural' as const;
    const tags = ['test', 'simplified'];
    const contentCid = computeContentCid(entryType, title, content, tags);

    // 1. Sign the CID
    const { data: signingRequest } = await createSigningRequest({
      client,
      auth: () => agent.accessToken,
      body: { message: contentCid },
    });
    const signature = await cryptoService.signWithNonce(
      contentCid,
      signingRequest!.nonce,
      agent.keyPair.privateKey,
    );
    await submitSignature({
      client,
      auth: () => agent.accessToken,
      path: { id: signingRequest!.id },
      body: { signature },
    });

    // 2. Create entry WITHOUT contentHash — server computes it
    const { data: entry, error: createError } = await createDiaryEntry({
      client,
      auth: () => agent.accessToken,
      path: { diaryId: agent.privateDiaryId },
      body: {
        content,
        title,
        entryType,
        tags,
        signingRequestId: signingRequest!.id,
      },
    });

    expect(createError).toBeUndefined();
    expect(entry!.contentHash).toBe(contentCid);
    expect(entry!.contentSignature).toBe(signature);

    // 3. Verify
    const { data: verification } = await verifyDiaryEntryById({
      client,
      auth: () => agent.accessToken,
      path: { entryId: entry!.id },
    });

    expect(verification!.valid).toBe(true);
    expect(verification!.contentHash).toBe(contentCid);
  });

  // ── Immutability enforcement ─────────────────────────────────

  it('rejects content update on signed entry → 409', async () => {
    const content = 'Immutable content test';
    const entryType = 'reflection';
    const contentCid = computeContentCid(entryType, null, content, null);

    // Sign and create
    const { data: signingRequest } = await createSigningRequest({
      client,
      auth: () => agent.accessToken,
      body: { message: contentCid },
    });
    const signature = await cryptoService.signWithNonce(
      contentCid,
      signingRequest!.nonce,
      agent.keyPair.privateKey,
    );
    await submitSignature({
      client,
      auth: () => agent.accessToken,
      path: { id: signingRequest!.id },
      body: { signature },
    });

    const { data: entry } = await createDiaryEntry({
      client,
      auth: () => agent.accessToken,
      path: { diaryId: agent.privateDiaryId },
      body: {
        content,
        entryType,
        contentHash: contentCid,
        signingRequestId: signingRequest!.id,
      },
    });

    // Attempt to update content → 409
    const { error, response } = await updateDiaryEntryById({
      client,
      auth: () => agent.accessToken,
      path: { entryId: entry!.id },
      body: { content: 'Tampered content' },
    });

    expect(error).toBeDefined();
    expect(response.status).toBe(409);
  });

  it('allows supersededBy on signed entry', async () => {
    const content = 'Will be superseded';
    const entryType = 'semantic';
    const contentCid = computeContentCid(entryType, null, content, null);

    // Sign and create
    const { data: signingRequest } = await createSigningRequest({
      client,
      auth: () => agent.accessToken,
      body: { message: contentCid },
    });
    const signature = await cryptoService.signWithNonce(
      contentCid,
      signingRequest!.nonce,
      agent.keyPair.privateKey,
    );
    await submitSignature({
      client,
      auth: () => agent.accessToken,
      path: { id: signingRequest!.id },
      body: { signature },
    });

    const { data: entry } = await createDiaryEntry({
      client,
      auth: () => agent.accessToken,
      path: { diaryId: agent.privateDiaryId },
      body: {
        content,
        entryType,
        contentHash: contentCid,
        signingRequestId: signingRequest!.id,
      },
    });

    // Create a newer entry to supersede with
    const { data: newer } = await createDiaryEntry({
      client,
      auth: () => agent.accessToken,
      path: { diaryId: agent.privateDiaryId },
      body: { content: 'Newer version' },
    });

    // supersededBy should succeed on signed entry
    const { data: updated, error } = await updateDiaryEntryById({
      client,
      auth: () => agent.accessToken,
      path: { entryId: entry!.id },
      body: { supersededBy: newer!.id },
    });

    expect(error).toBeUndefined();
    expect(updated!.supersededBy).toBe(newer!.id);
  });

  // ── Unsigned entries remain mutable ──────────────────────────

  it('allows content update on unsigned entry', async () => {
    const { data: entry } = await createDiaryEntry({
      client,
      auth: () => agent.accessToken,
      path: { diaryId: agent.privateDiaryId },
      body: { content: 'Mutable entry', entryType: 'semantic' },
    });

    // All entries now get a contentHash at creation (CIDv1, raw codec)
    expect(entry!.contentHash).toMatch(/^bafk/);
    expect(entry!.contentSignature).toBeNull();

    const { data: updated, error } = await updateDiaryEntryById({
      client,
      auth: () => agent.accessToken,
      path: { entryId: entry!.id },
      body: { content: 'Updated mutable entry' },
    });

    expect(error).toBeUndefined();
    expect(updated!.content).toBe('Updated mutable entry');
  });

  // ── Verify endpoint for unsigned entry ───────────────────────

  it('returns signed=false for unsigned entry', async () => {
    const { data: entry } = await createDiaryEntry({
      client,
      auth: () => agent.accessToken,
      path: { diaryId: agent.privateDiaryId },
      body: { content: 'No signature here' },
    });

    const { data: verification, error } = await verifyDiaryEntryById({
      client,
      auth: () => agent.accessToken,
      path: { entryId: entry!.id },
    });

    expect(error).toBeUndefined();
    expect(verification!.signed).toBe(false);
    expect(verification!.valid).toBe(false);
  });

  // ── Validation: partial signing fields ───────────────────────

  it('rejects entry with contentHash but no signingRequestId → 400', async () => {
    const contentCid = computeContentCid('semantic', null, 'test', null);

    const { error, response } = await createDiaryEntry({
      client,
      auth: () => agent.accessToken,
      path: { diaryId: agent.privateDiaryId },
      body: {
        content: 'test',
        contentHash: contentCid,
      },
    });

    expect(error).toBeDefined();
    expect(response.status).toBe(400);
  });

  // ── CID mismatch detection ───────────────────────────────────

  it('rejects entry with mismatched contentHash → 400', async () => {
    const content = 'Real content';
    const fakeCid = computeContentCid('semantic', null, 'Fake content', null);

    // Sign the fake CID
    const { data: signingRequest } = await createSigningRequest({
      client,
      auth: () => agent.accessToken,
      body: { message: fakeCid },
    });
    const signature = await cryptoService.signWithNonce(
      fakeCid,
      signingRequest!.nonce,
      agent.keyPair.privateKey,
    );
    await submitSignature({
      client,
      auth: () => agent.accessToken,
      path: { id: signingRequest!.id },
      body: { signature },
    });

    // Try to create with real content but fake CID
    const { error, response } = await createDiaryEntry({
      client,
      auth: () => agent.accessToken,
      path: { diaryId: agent.privateDiaryId },
      body: {
        content,
        contentHash: fakeCid,
        signingRequestId: signingRequest!.id,
      },
    });

    expect(error).toBeDefined();
    expect(response.status).toBe(400);
  });

  // ── Read-back signed fields ──────────────────────────────────

  it('persists contentHash and contentSignature on read-back', async () => {
    const content = 'Persistent fields test';
    const entryType = 'procedural';
    const contentCid = computeContentCid(entryType, null, content, null);

    const { data: signingRequest } = await createSigningRequest({
      client,
      auth: () => agent.accessToken,
      body: { message: contentCid },
    });
    const signature = await cryptoService.signWithNonce(
      contentCid,
      signingRequest!.nonce,
      agent.keyPair.privateKey,
    );
    await submitSignature({
      client,
      auth: () => agent.accessToken,
      path: { id: signingRequest!.id },
      body: { signature },
    });

    const { data: entry } = await createDiaryEntry({
      client,
      auth: () => agent.accessToken,
      path: { diaryId: agent.privateDiaryId },
      body: {
        content,
        entryType,
        contentHash: contentCid,
        signingRequestId: signingRequest!.id,
      },
    });

    // Read back
    const { data: fetched } = await getDiaryEntryById({
      client,
      auth: () => agent.accessToken,
      path: { entryId: entry!.id },
    });

    expect(fetched!.contentHash).toBe(contentCid);
    expect(fetched!.contentSignature).toBe(signature);
  });
});
