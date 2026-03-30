/**
 * E2E: Rendered pack lifecycle
 *
 * Tests the full rendered pack flow: create a custom pack, render it,
 * verify CID immutability, re-render (append-only), fetch latest,
 * fetch by ID, permission checks, and preview mode.
 */

import { createHash } from 'node:crypto';

import {
  type Client,
  type ContextPackResponse,
  createClient,
  createDiaryCustomPack,
  createDiaryEntry,
  getContextPackById,
  getLatestRenderedPack,
  getRenderedPackById,
  listDiaryEntries,
  listDiaryPacks,
  renderContextPack,
  type RenderedPackPreview,
  type RenderedPackResult,
  type RenderedPackWithContent,
} from '@moltnet/api-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, createTestVoucher, type TestAgent } from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

// Intentionally duplicates the server formatter so this remains a contract test
// for the exact markdown shape persisted by trusted server render methods.
function renderExpectedMarkdown(pack: ContextPackResponse): string {
  const entries = [...(pack.entries ?? [])].sort(
    (a, b) =>
      (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER),
  );
  const lines: string[] = [];

  lines.push(`# Context Pack ${pack.id}`);
  lines.push('');
  lines.push(`- Created: ${pack.createdAt}`);
  lines.push(`- Entries: ${entries.length}`);
  lines.push('');

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const heading = entry.entry.title ?? `Entry ${i + 1}`;
    lines.push(`### ${heading}`);
    lines.push('');
    lines.push(`- Entry ID: \`${entry.entryId}\``);
    lines.push(`- CID: \`${entry.entryCidSnapshot}\``);
    lines.push(`- Compression: \`${entry.compressionLevel}\``);
    lines.push(
      `- Tokens: ${entry.packedTokens ?? '?'}/${entry.originalTokens ?? '?'}`,
    );
    lines.push('');
    lines.push(entry.entry.content);
    lines.push('');
  }

  return lines.join('\n');
}

describe('Rendered packs', () => {
  let harness: TestHarness;
  let client: Client;
  let agentA: TestAgent;
  let agentB: TestAgent;
  let sourcePackId: string;
  let sourcePack: ContextPackResponse;
  let expectedServerMarkdown: string;

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

    // Create diary entries for pack content in a fixed order so the expected
    // server-rendered markdown is deterministic.
    const { data: firstEntry } = await createDiaryEntry({
      client,
      auth: () => agentA.accessToken,
      path: { diaryId: agentA.moltnetDiaryId },
      body: {
        content: 'Authentication middleware uses RS256 JWT tokens from Ory.',
        tags: ['auth', 'middleware'],
        title: 'Auth middleware notes',
      },
    });
    const { data: secondEntry } = await createDiaryEntry({
      client,
      auth: () => agentA.accessToken,
      path: { diaryId: agentA.moltnetDiaryId },
      body: {
        content: 'Keto permission checks use relation tuples for diary access.',
        tags: ['auth', 'keto'],
        title: 'Keto permission model',
      },
    });
    expect(firstEntry).toBeDefined();
    expect(secondEntry).toBeDefined();

    const { data: packData } = await createDiaryCustomPack({
      client,
      auth: () => agentA.accessToken,
      path: { id: agentA.moltnetDiaryId },
      body: {
        packType: 'custom',
        params: { recipe: 'render-test' },
        entries: [
          { entryId: firstEntry!.id, rank: 1 },
          { entryId: secondEntry!.id, rank: 2 },
        ],
        pinned: true,
      },
    });
    expect(packData).toBeDefined();

    // Find the persisted pack
    const { data: packs } = await listDiaryPacks({
      client,
      auth: () => agentA.accessToken,
      path: { id: agentA.moltnetDiaryId },
    });
    const match = packs!.items.find((p) => p.packCid === packData!.packCid);
    expect(match).toBeDefined();
    sourcePackId = match!.id;

    const { data: expandedPack } = await getContextPackById({
      client,
      auth: () => agentA.accessToken,
      path: { id: sourcePackId },
      query: { expand: 'entries' },
    });
    expect(expandedPack).toBeDefined();
    expect(expandedPack?.entries).toHaveLength(2);
    sourcePack = expandedPack as ContextPackResponse;
    expectedServerMarkdown = renderExpectedMarkdown(sourcePack);
  }, 60_000);

  afterAll(async () => {
    await harness?.teardown();
  });

  it('returns 401 for render without auth', async () => {
    const response = await fetch(
      `${harness.baseUrl}/packs/${sourcePackId}/render`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          renderMethod: 'server:pack-to-docs-v1',
        }),
      },
    );

    expect(response.status).toBe(401);
  });

  it('previews a rendered pack without persisting', async () => {
    const { data, error, response } = await renderContextPack({
      client,
      auth: () => agentA.accessToken,
      path: { id: sourcePackId },
      body: {
        renderMethod: 'server:pack-to-docs-v1',
        preview: true,
      },
    });

    expect(error, `preview failed: ${JSON.stringify(error)}`).toBeUndefined();
    expect(response.status).toBe(200);
    const preview = data as RenderedPackPreview;
    expect(preview.sourcePackId).toBe(sourcePackId);
    expect(preview.sourcePackCid).toBe(sourcePack.packCid);
    expect(preview.renderMethod).toBe('server:pack-to-docs-v1');
    expect(preview.renderedMarkdown).toBe(expectedServerMarkdown);
    expect(preview.totalTokens).toBeGreaterThan(0);
  });

  it('creates a server-rendered pack with CID', async () => {
    const { data, error, response } = await renderContextPack({
      client,
      auth: () => agentA.accessToken,
      path: { id: sourcePackId },
      body: {
        renderMethod: 'server:pack-to-docs-v1',
      },
    });

    expect(error, `render failed: ${JSON.stringify(error)}`).toBeUndefined();
    expect(response.status).toBe(201);
    const result = data as RenderedPackResult;
    expect(result.id).toBeDefined();
    expect(result.packCid).toMatch(/^bafyr/);
    expect(result.sourcePackId).toBe(sourcePackId);
    expect(result.sourcePackCid).toBe(sourcePack.packCid);
    expect(result.contentHash).toBe(
      createHash('sha256').update(expectedServerMarkdown).digest('hex'),
    );
    expect(result.renderMethod).toBe('server:pack-to-docs-v1');
    expect(result.renderedMarkdown).toBe(expectedServerMarkdown);
    expect(result.totalTokens).toBeGreaterThan(0);
  });

  it('persists the exact server-rendered markdown for later injection', async () => {
    const { data, error, response } = await getLatestRenderedPack({
      client,
      auth: () => agentA.accessToken,
      path: { id: sourcePackId },
    });

    expect(error, `getLatest failed: ${JSON.stringify(error)}`).toBeUndefined();
    expect(response.status).toBe(200);
    const latest = data as RenderedPackWithContent;
    expect(latest.renderMethod).toBe('server:pack-to-docs-v1');
    expect(latest.content).toBe(expectedServerMarkdown);
    expect(latest.contentHash).toBe(
      createHash('sha256').update(expectedServerMarkdown).digest('hex'),
    );
  });

  it('returns existing pack on idempotent server re-render', async () => {
    const { data: first } = await renderContextPack({
      client,
      auth: () => agentA.accessToken,
      path: { id: sourcePackId },
      body: {
        renderMethod: 'server:pack-to-docs-v1',
      },
    });

    const { data: second } = await renderContextPack({
      client,
      auth: () => agentA.accessToken,
      path: { id: sourcePackId },
      body: {
        renderMethod: 'server:pack-to-docs-v1',
      },
    });

    expect((first as RenderedPackResult).packCid).toBe(
      (second as RenderedPackResult).packCid,
    );
    expect((first as RenderedPackResult).id).toBe(
      (second as RenderedPackResult).id,
    );
  });

  it('creates a new version when agent-rendered content changes', async () => {
    const { data: v1 } = await renderContextPack({
      client,
      auth: () => agentA.accessToken,
      path: { id: sourcePackId },
      body: {
        renderedMarkdown: '# Version 1\n\nOriginal content.',
        renderMethod: 'agent-refined',
      },
    });

    const { data: v2 } = await renderContextPack({
      client,
      auth: () => agentA.accessToken,
      path: { id: sourcePackId },
      body: {
        renderedMarkdown: '# Version 2\n\nUpdated content with new info.',
        renderMethod: 'agent-refined',
      },
    });

    expect((v1 as RenderedPackResult).packCid).not.toBe(
      (v2 as RenderedPackResult).packCid,
    );
  });

  it('fetches the latest rendered pack for a source pack', async () => {
    const { data, error, response } = await getLatestRenderedPack({
      client,
      auth: () => agentA.accessToken,
      path: { id: sourcePackId },
    });

    expect(error, `getLatest failed: ${JSON.stringify(error)}`).toBeUndefined();
    expect(response.status).toBe(200);
    const latest = data as RenderedPackWithContent;
    expect(latest.id).toBeDefined();
    expect(latest.packCid).toBeDefined();
    expect(latest.content).toContain('Version 2');
  });

  it('fetches a rendered pack by ID', async () => {
    const { data: latestData } = await getLatestRenderedPack({
      client,
      auth: () => agentA.accessToken,
      path: { id: sourcePackId },
    });
    const latest = latestData as RenderedPackWithContent;

    const { data, error, response } = await getRenderedPackById({
      client,
      auth: () => agentA.accessToken,
      path: { id: latest.id },
    });

    expect(error, `getById failed: ${JSON.stringify(error)}`).toBeUndefined();
    expect(response.status).toBe(200);
    expect((data as RenderedPackWithContent).packCid).toBe(latest.packCid);
  });

  it('returns 403 when another agent tries to read a rendered pack', async () => {
    const { data: latestData } = await getLatestRenderedPack({
      client,
      auth: () => agentA.accessToken,
      path: { id: sourcePackId },
    });
    const latest = latestData as RenderedPackWithContent;

    const { error, response } = await getRenderedPackById({
      client,
      auth: () => agentB.accessToken,
      path: { id: latest.id },
    });

    expect(error).toBeDefined();
    expect(response.status).toBe(403);
  });

  it('returns 403 when another agent tries to render a pack', async () => {
    const { error, response } = await renderContextPack({
      client,
      auth: () => agentB.accessToken,
      path: { id: sourcePackId },
      body: {
        renderMethod: 'server:pack-to-docs-v1',
      },
    });

    expect(error).toBeDefined();
    expect(response.status).toBe(403);
  });

  it('returns 404 for non-existent source pack', async () => {
    const { error, response } = await renderContextPack({
      client,
      auth: () => agentA.accessToken,
      path: { id: '00000000-0000-0000-0000-000000000000' },
      body: {
        renderMethod: 'server:pack-to-docs-v1',
      },
    });

    expect(error).toBeDefined();
    expect(response.status).toBe(404);
  });

  it('returns 400 when server render methods receive renderedMarkdown', async () => {
    const { error, response } = await renderContextPack({
      client,
      auth: () => agentA.accessToken,
      path: { id: sourcePackId },
      body: {
        renderedMarkdown: '# Should be ignored',
        renderMethod: 'server:pack-to-docs-v1',
      },
    });

    expect(error).toBeDefined();
    expect(response.status).toBe(400);
  });

  it('returns 400 when non-server render methods omit renderedMarkdown', async () => {
    const { error, response } = await renderContextPack({
      client,
      auth: () => agentA.accessToken,
      path: { id: sourcePackId },
      body: {
        renderMethod: 'agent-refined',
      },
    });

    expect(error).toBeDefined();
    expect(response.status).toBe(400);
  });

  it('returns 404 for latest rendered of a pack with no renders', async () => {
    // Create a new pack with no rendered versions
    const { data: entries } = await listDiaryEntries({
      client,
      auth: () => agentA.accessToken,
      path: { diaryId: agentA.moltnetDiaryId },
      query: { limit: 1 },
    });

    const { data: packData } = await createDiaryCustomPack({
      client,
      auth: () => agentA.accessToken,
      path: { id: agentA.moltnetDiaryId },
      body: {
        packType: 'custom',
        params: { recipe: 'no-render-test' },
        entries: [{ entryId: entries!.items[0].id, rank: 1 }],
      },
    });

    const { data: packs } = await listDiaryPacks({
      client,
      auth: () => agentA.accessToken,
      path: { id: agentA.moltnetDiaryId },
    });
    const noRenderPack = packs!.items.find(
      (p) => p.packCid === packData!.packCid,
    );

    const { error, response } = await getLatestRenderedPack({
      client,
      auth: () => agentA.accessToken,
      path: { id: noRenderPack!.id },
    });

    expect(error).toBeDefined();
    expect(response.status).toBe(404);
  }, 30_000);
});
