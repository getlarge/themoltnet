import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createMockServices,
  createTestApp,
  DIARY_ID,
  OWNER_ID,
  OWNER_IDENTITY_ID,
  resetMockServices,
  TEST_BEARER_TOKEN,
  VALID_AUTH_CONTEXT,
} from './helpers.js';

const authHeaders = { authorization: `Bearer ${TEST_BEARER_TOKEN}` };
const SOURCE_PACK_ID = 'bb000000-0000-0000-0000-000000000001';

const RENDERED_RESULT = {
  id: 'aa000000-0000-0000-0000-000000000001',
  sourcePackId: SOURCE_PACK_ID,
  sourcePackCid: 'bafy-source-1',
  packCid: 'bafy-rendered-1',
  diaryId: DIARY_ID,
  contentHash: 'sha256:aaa',
  renderMethod: 'agent-refined',
  renderedMarkdown: '# Rendered pack\n',
  totalTokens: 200,
  creator: {
    kind: 'agent' as const,
    agentId: OWNER_ID,
    identityId: OWNER_IDENTITY_ID,
    fingerprint: 'A1B2-C3D4-E5F6-1234',
    publicKey: 'ed25519:mockkeypayload',
  },
  pinned: false,
};

/**
 * The renderMethod convention is owned by `@moltnet/models` (#1857) and
 * enforced at the API boundary: unrecognised labels never reach the service.
 */
describe('rendered pack render routes — renderMethod validation', () => {
  let app: FastifyInstance;
  let mocks: ReturnType<typeof createMockServices>;

  beforeAll(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks, VALID_AUTH_CONTEXT);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    resetMockServices(mocks);
  });

  it.each(['pack-to-docs-v1', 'homegrown', 'server:', 'agent:'])(
    'rejects POST /packs/:id/render with renderMethod %j before the service runs',
    async (renderMethod) => {
      const response = await app.inject({
        method: 'POST',
        url: `/packs/${SOURCE_PACK_ID}/render`,
        headers: authHeaders,
        payload: { renderMethod, renderedMarkdown: '# x\n' },
      });

      expect(response.statusCode).toBe(400);
      expect(
        mocks.contextPackService.createRenderedPack,
      ).not.toHaveBeenCalled();
    },
  );

  it('rejects POST /packs/:id/render/preview with an unrecognised renderMethod', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/packs/${SOURCE_PACK_ID}/render/preview`,
      headers: authHeaders,
      payload: { renderMethod: 'markdown', renderedMarkdown: '# x\n' },
    });

    expect(response.statusCode).toBe(400);
    expect(mocks.contextPackService.previewRenderedPack).not.toHaveBeenCalled();
  });

  // Every value present in production data must keep working unchanged.
  it.each(['server:pack-to-docs-v1', 'agent:pack-to-docs-v1', 'agent-refined'])(
    'passes renderMethod %s through to the service',
    async (renderMethod) => {
      mocks.contextPackRepository.findById.mockResolvedValue({
        id: SOURCE_PACK_ID,
        diaryId: DIARY_ID,
      } as never);
      mocks.permissionChecker.canWritePack.mockResolvedValue(true);
      mocks.contextPackService.createRenderedPack.mockResolvedValue({
        ...RENDERED_RESULT,
        renderMethod,
      });

      const response = await app.inject({
        method: 'POST',
        url: `/packs/${SOURCE_PACK_ID}/render`,
        headers: authHeaders,
        payload: {
          renderMethod,
          ...(renderMethod.startsWith('server:')
            ? {}
            : { renderedMarkdown: '# x\n' }),
        },
      });

      expect(response.statusCode).toBe(201);
      expect(mocks.contextPackService.createRenderedPack).toHaveBeenCalledWith(
        expect.objectContaining({ renderMethod }),
      );
    },
  );
});
