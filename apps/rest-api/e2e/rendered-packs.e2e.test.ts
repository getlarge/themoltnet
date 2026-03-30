/**
 * E2E: Rendered pack lifecycle
 *
 * Tests the full rendered pack flow: create a custom pack, render it,
 * verify CID immutability, re-render (append-only), fetch latest,
 * fetch by ID, permission checks, and preview mode.
 */

import {
  type Client,
  createClient,
  createDiaryCustomPack,
  createDiaryEntry,
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

import { createAgent, type TestAgent } from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

describe('Rendered packs', () => {
  let harness: TestHarness;
  let client: Client;
  let agentA: TestAgent;
  let agentB: TestAgent;
  let sourcePackId: string;

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

    // Create diary entries for pack content
    await Promise.all([
      createDiaryEntry({
        client,
        auth: () => agentA.accessToken,
        path: { diaryId: agentA.moltnetDiaryId },
        body: {
          content: 'Authentication middleware uses RS256 JWT tokens from Ory.',
          tags: ['auth', 'middleware'],
          title: 'Auth middleware notes',
        },
      }),
      createDiaryEntry({
        client,
        auth: () => agentA.accessToken,
        path: { diaryId: agentA.moltnetDiaryId },
        body: {
          content:
            'Keto permission checks use relation tuples for diary access.',
          tags: ['auth', 'keto'],
          title: 'Keto permission model',
        },
      }),
    ]);

    // Create a custom pack as the source for rendering
    const { data: entries } = await listDiaryEntries({
      client,
      auth: () => agentA.accessToken,
      path: { diaryId: agentA.moltnetDiaryId },
      query: { limit: 10 },
    });

    const { data: packData } = await createDiaryCustomPack({
      client,
      auth: () => agentA.accessToken,
      path: { id: agentA.moltnetDiaryId },
      body: {
        packType: 'custom',
        params: { recipe: 'render-test' },
        entries: entries!.items.map((e, i) => ({
          entryId: e.id,
          rank: i + 1,
        })),
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
          renderedMarkdown: '# Hello',
          renderMethod: 'pack-to-docs-v1',
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
        renderedMarkdown: '# Preview content\n\nThis is a preview.',
        renderMethod: 'pack-to-docs-v1',
        preview: true,
      },
    });

    expect(error, `preview failed: ${JSON.stringify(error)}`).toBeUndefined();
    expect(response.status).toBe(200);
    const preview = data as RenderedPackPreview;
    expect(preview.sourcePackId).toBeDefined();
    expect(preview.sourcePackCid).toBeDefined();
    expect(preview.totalTokens).toBeGreaterThan(0);
  });

  it('creates a rendered pack with CID', async () => {
    const markdown =
      '# Auth Middleware\n\nRS256 JWT from Ory.\n\n# Keto\n\nRelation tuples.';
    const { data, error, response } = await renderContextPack({
      client,
      auth: () => agentA.accessToken,
      path: { id: sourcePackId },
      body: {
        renderedMarkdown: markdown,
        renderMethod: 'pack-to-docs-v1',
      },
    });

    expect(error, `render failed: ${JSON.stringify(error)}`).toBeUndefined();
    expect(response.status).toBe(201);
    const result = data as RenderedPackResult;
    expect(result.id).toBeDefined();
    expect(result.packCid).toMatch(/^bafyr/);
    expect(result.sourcePackId).toBe(sourcePackId);
    expect(result.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.renderMethod).toBe('pack-to-docs-v1');
    expect(result.totalTokens).toBeGreaterThan(0);
  });

  it('returns existing pack on idempotent re-render with same content', async () => {
    const markdown =
      '# Auth Middleware\n\nRS256 JWT from Ory.\n\n# Keto\n\nRelation tuples.';

    const { data: first } = await renderContextPack({
      client,
      auth: () => agentA.accessToken,
      path: { id: sourcePackId },
      body: {
        renderedMarkdown: markdown,
        renderMethod: 'pack-to-docs-v1',
      },
    });

    const { data: second } = await renderContextPack({
      client,
      auth: () => agentA.accessToken,
      path: { id: sourcePackId },
      body: {
        renderedMarkdown: markdown,
        renderMethod: 'pack-to-docs-v1',
      },
    });

    expect((first as RenderedPackResult).packCid).toBe(
      (second as RenderedPackResult).packCid,
    );
  });

  it('creates a new version when content changes (append-only)', async () => {
    const { data: v1 } = await renderContextPack({
      client,
      auth: () => agentA.accessToken,
      path: { id: sourcePackId },
      body: {
        renderedMarkdown: '# Version 1\n\nOriginal content.',
        renderMethod: 'pack-to-docs-v1',
      },
    });

    const { data: v2 } = await renderContextPack({
      client,
      auth: () => agentA.accessToken,
      path: { id: sourcePackId },
      body: {
        renderedMarkdown: '# Version 2\n\nUpdated content with new info.',
        renderMethod: 'pack-to-docs-v1',
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
        renderedMarkdown: '# Unauthorized',
        renderMethod: 'pack-to-docs-v1',
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
        renderedMarkdown: '# Hello',
        renderMethod: 'pack-to-docs-v1',
      },
    });

    expect(error).toBeDefined();
    expect(response.status).toBe(404);
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
