/**
 * E2E: Runtime Models Catalog API
 *
 * Covers the team-scoped runtime model catalog CRUD against a real REST
 * API, database, and Keto stack:
 *
 *   - access rules (owning team, outsiders, global entries readable
 *     by any authenticated agent)
 *   - input validation (missing team header, regex-bounded provider /
 *     model fields, partial-update constraints, unique violation)
 *   - read-only protection of global entries (PATCH/DELETE forbidden
 *     through the public API)
 *   - provider filter on the list endpoint
 *
 * Each `it` is independent: the catalog is shared across all tests in
 * this file (and across the rest of the suite — see #1369 follow-up for
 * the cleanup-pruning discussion), so we use unique provider suffixes
 * (`e2e-<timestamp>-<rand>`) to avoid cross-test collisions instead of
 * tearing the table down between cases.
 */

import {
  createClient,
  createRuntimeModel,
  deleteRuntimeModel,
  getRuntimeModel,
  listRuntimeModels,
  updateRuntimeModel,
} from '@moltnet/api-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, type TestAgent } from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

describe('Runtime Models Catalog API', () => {
  let harness: TestHarness;
  let client: ReturnType<typeof createClient>;
  let owner: TestAgent;
  let outsider: TestAgent;

  // 16 hex chars ≈ 64 bits of entropy — enough to avoid collisions with
  // the rest of the suite running in parallel on the same e2e stack.
  const suffix = () =>
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => {
    harness = await createTestHarness();
    client = createClient({ baseUrl: harness.baseUrl });

    [owner, outsider] = await Promise.all([
      createAgent({
        baseUrl: harness.baseUrl,
        db: harness.db,
        bootstrapIdentityId: harness.bootstrapIdentityId,
      }),
      createAgent({
        baseUrl: harness.baseUrl,
        db: harness.db,
        bootstrapIdentityId: harness.bootstrapIdentityId,
      }),
    ]);
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  function createBody(tag: string) {
    return {
      // Mixed-case payload — the route lowercases on write.
      provider: `E2E-${tag}`,
      model: `model-${tag}`,
      displayName: `e2e ${tag}`,
      description: `e2e model for ${tag}`,
      capabilities: { supportsTools: true, contextWindow: 200_000 },
    };
  }

  function createWithOwner(tag: string) {
    return createRuntimeModel({
      client,
      auth: () => owner.accessToken,
      headers: { 'x-moltnet-team-id': owner.personalTeamId },
      body: createBody(tag),
    });
  }

  it('creates, lists, gets, updates, and deletes a team-scoped entry', async () => {
    const tag = suffix();
    const {
      data: created,
      error: createError,
      response: createResponse,
    } = await createWithOwner(tag);
    expect(createResponse.status).toBe(201);
    expect(createError).toBeUndefined();
    expect(created).toMatchObject({
      teamId: owner.personalTeamId,
      provider: `e2e-${tag}`,
      model: `model-${tag}`,
      displayName: `e2e ${tag}`,
      isActive: true,
    });
    expect(created!.capabilities).toEqual({
      supportsTools: true,
      contextWindow: 200_000,
    });

    const { data: listed, response: listResponse } = await listRuntimeModels({
      client,
      auth: () => owner.accessToken,
      headers: { 'x-moltnet-team-id': owner.personalTeamId },
    });
    expect(listResponse.status).toBe(200);
    expect(listed!.items.map((i) => i.id)).toContain(created!.id);

    const { data: fetched, response: getResponse } = await getRuntimeModel({
      client,
      auth: () => owner.accessToken,
      path: { modelId: created!.id },
    });
    expect(getResponse.status).toBe(200);
    expect(fetched!.id).toBe(created!.id);

    const { data: updated, response: updateResponse } =
      await updateRuntimeModel({
        client,
        auth: () => owner.accessToken,
        path: { modelId: created!.id },
        body: { displayName: `e2e ${tag} renamed` },
      });
    expect(updateResponse.status).toBe(200);
    expect(updated!.displayName).toBe(`e2e ${tag} renamed`);

    const { response: deleteResponse } = await deleteRuntimeModel({
      client,
      auth: () => owner.accessToken,
      path: { modelId: created!.id },
    });
    expect(deleteResponse.status).toBe(204);

    const { response: getAfterDelete } = await getRuntimeModel({
      client,
      auth: () => owner.accessToken,
      path: { modelId: created!.id },
    });
    expect(getAfterDelete.status).toBe(404);
  });

  it('lists the seeded global catalog when no team header is set', async () => {
    const { data, response } = await listRuntimeModels({
      client,
      auth: () => owner.accessToken,
    });
    expect(response.status).toBe(200);
    // 13 seeded couples from migration 0021. We don't assert a hard count
    // (a future seed bump would force a noisy test fix), only that the
    // well-known seed rows are present.
    const providers = new Set(data!.items.map((i) => i.provider));
    expect(providers.has('anthropic')).toBe(true);
    expect(providers.has('openai')).toBe(true);
    expect(providers.has('ollama')).toBe(true);
    // Seeded entries are global → no teamId.
    for (const item of data!.items) {
      expect(item.teamId).toBeNull();
    }
  });

  it('exposes global entries to any authenticated agent', async () => {
    // Pick a well-known seed row.
    const { data: listData } = await listRuntimeModels({
      client,
      auth: () => owner.accessToken,
      query: { provider: 'anthropic' },
    });
    const sonnet = listData!.items.find((i) => i.model === 'claude-sonnet-4-5');
    expect(sonnet).toBeDefined();

    // Outsider reads it.
    const { data, response } = await getRuntimeModel({
      client,
      auth: () => outsider.accessToken,
      path: { modelId: sonnet!.id },
    });
    expect(response.status).toBe(200);
    expect(data!.id).toBe(sonnet!.id);
    expect(data!.teamId).toBeNull();
  });

  it('filters the list by the provider query parameter', async () => {
    const tag = suffix();
    const { data: created } = await createWithOwner(tag);
    expect(created).toBeDefined();

    const { data, response } = await listRuntimeModels({
      client,
      auth: () => owner.accessToken,
      query: { provider: `e2e-${tag}` },
      headers: { 'x-moltnet-team-id': owner.personalTeamId },
    });
    expect(response.status).toBe(200);
    expect(data!.items.length).toBeGreaterThan(0);
    for (const item of data!.items) {
      expect(item.provider).toBe(`e2e-${tag}`);
    }
  });

  describe('access rules', () => {
    it('rejects an outsider creating an entry in a team they do not belong to', async () => {
      const tag = suffix();
      const { response } = await createRuntimeModel({
        client,
        auth: () => outsider.accessToken,
        headers: { 'x-moltnet-team-id': owner.personalTeamId },
        body: createBody(tag),
      });
      expect(response.status).toBe(403);
    });

    it("rejects an outsider listing another team's catalog", async () => {
      const { response } = await listRuntimeModels({
        client,
        auth: () => outsider.accessToken,
        headers: { 'x-moltnet-team-id': owner.personalTeamId },
      });
      expect(response.status).toBe(403);
    });

    it('hides a team-scoped entry from non-members (404, not 403)', async () => {
      const tag = suffix();
      const { data: created } = await createWithOwner(tag);
      expect(created).toBeDefined();

      const { response } = await getRuntimeModel({
        client,
        auth: () => outsider.accessToken,
        path: { modelId: created!.id },
      });
      expect(response.status).toBe(404);
    });

    it('rejects an outsider updating or deleting a team-scoped entry', async () => {
      const tag = suffix();
      const { data: created } = await createWithOwner(tag);
      expect(created).toBeDefined();

      const { response: updateResponse } = await updateRuntimeModel({
        client,
        auth: () => outsider.accessToken,
        path: { modelId: created!.id },
        body: { displayName: 'pwned' },
      });
      // Owner-only mutation. PATCH through the public API is gated by
      // `canManageTeam`; an outsider is not a member, so the check fails
      // with 403. The route does not pre-check team membership for the
      // PATCH path (see runtime-profiles.e2e.test.ts for the same pattern).
      expect(updateResponse.status).toBe(403);

      const { response: deleteResponse } = await deleteRuntimeModel({
        client,
        auth: () => outsider.accessToken,
        path: { modelId: created!.id },
      });
      expect(deleteResponse.status).toBe(403);
    });

    it('refuses to mutate a global (seeded) entry through the public API', async () => {
      const { data: listData } = await listRuntimeModels({
        client,
        auth: () => owner.accessToken,
      });
      const seed = listData!.items.find((i) => i.teamId === null);
      expect(seed).toBeDefined();

      const { response: updateResponse } = await updateRuntimeModel({
        client,
        auth: () => owner.accessToken,
        path: { modelId: seed!.id },
        body: { displayName: 'tampered' },
      });
      expect(updateResponse.status).toBe(403);

      const { response: deleteResponse } = await deleteRuntimeModel({
        client,
        auth: () => owner.accessToken,
        path: { modelId: seed!.id },
      });
      expect(deleteResponse.status).toBe(403);
    });
  });

  describe('input validation', () => {
    it('rejects POST without a team header', async () => {
      const tag = suffix();
      const { response } = await createRuntimeModel({
        client,
        auth: () => owner.accessToken,
        body: createBody(tag),
      });
      expect(response.status).toBe(400);
    });

    it('rejects a provider containing forbidden characters', async () => {
      const { response } = await createRuntimeModel({
        client,
        auth: () => owner.accessToken,
        headers: { 'x-moltnet-team-id': owner.personalTeamId },
        body: {
          // Space is outside the `^[a-zA-Z0-9._-]` pattern.
          provider: 'bad provider',
          model: 'm',
        },
      });
      expect(response.status).toBe(400);
    });

    it('rejects a model name containing forbidden characters', async () => {
      const { response } = await createRuntimeModel({
        client,
        auth: () => owner.accessToken,
        headers: { 'x-moltnet-team-id': owner.personalTeamId },
        body: {
          provider: 'e2e-ok',
          // Slashes are outside the `^[a-zA-Z0-9._:-]` pattern.
          model: 'a/b',
        },
      });
      expect(response.status).toBe(400);
    });

    it('rejects an empty provider', async () => {
      const { response } = await createRuntimeModel({
        client,
        auth: () => owner.accessToken,
        headers: { 'x-moltnet-team-id': owner.personalTeamId },
        body: { provider: '', model: 'm' },
      });
      expect(response.status).toBe(400);
    });

    it('rejects a PATCH with an empty body (minProperties: 1)', async () => {
      const tag = suffix();
      const { data: created } = await createWithOwner(tag);
      expect(created).toBeDefined();

      const { response } = await updateRuntimeModel({
        client,
        auth: () => owner.accessToken,
        path: { modelId: created!.id },
        body: {},
      });
      expect(response.status).toBe(400);
    });

    it('rejects a capabilities value that is not a primitive', async () => {
      // The schema constrains capabilities to boolean | number | string;
      // an object value is not assignable.
      const { response } = await createRuntimeModel({
        client,
        auth: () => owner.accessToken,
        headers: { 'x-moltnet-team-id': owner.personalTeamId },
        body: {
          provider: 'e2e-ok',
          model: 'm',
          // @ts-expect-error exercising runtime validation
          capabilities: { nested: { deep: 'value' } },
        },
      });
      expect(response.status).toBe(400);
    });

    it('maps a unique violation (same provider+model in same team) to 409', async () => {
      const tag = suffix();
      const { data: first } = await createWithOwner(tag);
      expect(first).toBeDefined();

      const { response } = await createWithOwner(tag);
      expect(response.status).toBe(409);
    });
  });
});
