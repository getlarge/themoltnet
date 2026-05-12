import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createMockServices,
  createTestApp,
  DIARY_ID,
  OWNER_ID,
  TEST_BEARER_TOKEN,
  VALID_AUTH_CONTEXT,
} from './helpers.js';

const authHeaders = { authorization: `Bearer ${TEST_BEARER_TOKEN}` };
const SOURCE_PACK_ID = 'bb000000-0000-0000-0000-000000000001';
const RENDERED_PACK_ID = 'aa000000-0000-0000-0000-000000000001';

const RENDERED_PACK = {
  id: RENDERED_PACK_ID,
  sourcePackId: SOURCE_PACK_ID,
  diaryId: DIARY_ID,
  packCid: 'bafy-rendered-1',
  content: '# Rendered pack\n',
  contentHash: 'sha256:aaa',
  renderMethod: 'agent-refined',
  totalTokens: 200,
  creator: {
    kind: 'agent' as const,
    identityId: OWNER_ID,
    fingerprint: 'A1B2-C3D4-E5F6-1234',
    publicKey: 'ed25519:mockkeypayload',
  },
  pinned: false,
  expiresAt: null,
  createdAt: new Date('2026-03-01T00:00:00Z'),
  verifiedTaskId: null,
  description: null,
};

describe('rendered pack GET routes', () => {
  let app: FastifyInstance;
  let mocks: ReturnType<typeof createMockServices>;

  beforeEach(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks, VALID_AUTH_CONTEXT);
  });

  it('returns creator on GET /rendered-packs/:id', async () => {
    mocks.contextPackService.getRenderedPackById.mockResolvedValue(
      RENDERED_PACK,
    );

    const response = await app.inject({
      method: 'GET',
      url: `/rendered-packs/${RENDERED_PACK_ID}`,
      headers: authHeaders,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().creator).toEqual(RENDERED_PACK.creator);
  });

  it('returns creator on GET /packs/:id/rendered', async () => {
    mocks.contextPackService.getLatestRenderedPack.mockResolvedValue(
      RENDERED_PACK,
    );

    const response = await app.inject({
      method: 'GET',
      url: `/packs/${SOURCE_PACK_ID}/rendered`,
      headers: authHeaders,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().creator).toEqual(RENDERED_PACK.creator);
  });
});
