import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createMockServices,
  createTestApp,
  VALID_AUTH_CONTEXT,
} from './helpers.js';

const TEST_RENDERED_PACK = {
  id: '00000000-0000-0000-0000-000000000001',
  sourcePackId: '00000000-0000-0000-0000-000000000002',
  renderMethod: 'agent-refined',
  diaryId: '00000000-0000-0000-0000-000000000003',
  content: '# Rendered',
  contentHash: 'sha256:abc',
  packCid: 'bafy123',
  totalTokens: 100,
  createdBy: VALID_AUTH_CONTEXT.identityId,
  pinned: false,
  expiresAt: null,
  createdAt: new Date(),
};

const NONCE = '00000000-0000-0000-0000-000000000099';

describe('POST /rendered-packs/:id/verify', () => {
  let app: FastifyInstance;
  let mocks: ReturnType<typeof createMockServices>;

  beforeEach(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks, VALID_AUTH_CONTEXT);
    mocks.renderedPackRepository.findById.mockResolvedValue(TEST_RENDERED_PACK);
    mocks.permissionChecker.canReadPack.mockResolvedValue(true);
    mocks.permissionChecker.canVerifyClaimPack.mockResolvedValue(true);
  });

  it('returns 201 with verificationId and nonce', async () => {
    mocks.verificationService.createVerification.mockResolvedValue({
      verificationId: 'wf-1',
      nonce: NONCE,
    });

    const response = await app.inject({
      method: 'POST',
      url: `/rendered-packs/${TEST_RENDERED_PACK.id}/verify`,
      headers: { authorization: 'Bearer test-token' },
      payload: { nonce: NONCE },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      verificationId: 'wf-1',
      nonce: NONCE,
    });
  });

  it('returns 400 when renderMethod is server:*', async () => {
    mocks.renderedPackRepository.findById.mockResolvedValue({
      ...TEST_RENDERED_PACK,
      renderMethod: 'server:pack-to-docs-v1',
    });

    const response = await app.inject({
      method: 'POST',
      url: `/rendered-packs/${TEST_RENDERED_PACK.id}/verify`,
      headers: { authorization: 'Bearer test-token' },
      payload: { nonce: NONCE },
    });

    expect(response.statusCode).toBe(400);
  });

  it('returns 400 when renderMethod is already verified', async () => {
    mocks.renderedPackRepository.findById.mockResolvedValue({
      ...TEST_RENDERED_PACK,
      renderMethod: 'agent-refined:verified',
    });

    const response = await app.inject({
      method: 'POST',
      url: `/rendered-packs/${TEST_RENDERED_PACK.id}/verify`,
      headers: { authorization: 'Bearer test-token' },
      payload: { nonce: NONCE },
    });

    expect(response.statusCode).toBe(400);
  });

  it('returns 404 when rendered pack not found', async () => {
    mocks.renderedPackRepository.findById.mockResolvedValue(null);

    const response = await app.inject({
      method: 'POST',
      url: `/rendered-packs/${TEST_RENDERED_PACK.id}/verify`,
      headers: { authorization: 'Bearer test-token' },
      payload: { nonce: NONCE },
    });

    expect(response.statusCode).toBe(404);
  });

  it('returns 403 when caller cannot read source pack', async () => {
    mocks.permissionChecker.canReadPack.mockResolvedValue(false);

    const response = await app.inject({
      method: 'POST',
      url: `/rendered-packs/${TEST_RENDERED_PACK.id}/verify`,
      headers: { authorization: 'Bearer test-token' },
      payload: { nonce: NONCE },
    });

    expect(response.statusCode).toBe(403);
  });
});

describe('POST /rendered-packs/:id/verify/claim', () => {
  let app: FastifyInstance;
  let mocks: ReturnType<typeof createMockServices>;

  beforeEach(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks, VALID_AUTH_CONTEXT);
    mocks.renderedPackRepository.findById.mockResolvedValue(TEST_RENDERED_PACK);
    mocks.permissionChecker.canVerifyClaimPack.mockResolvedValue(true);
    mocks.verificationService.claim.mockResolvedValue({
      sourceEntries: [{ title: 't', content: 'c', contentHash: 'h' }],
      renderedContent: '# rendered',
      rubric: 'rubric',
    });
  });

  it('returns 200 for authorized team member', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/rendered-packs/${TEST_RENDERED_PACK.id}/verify/claim`,
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.verificationService.claim).toHaveBeenCalledWith(
      TEST_RENDERED_PACK.id,
      VALID_AUTH_CONTEXT.identityId,
    );
  });

  it('returns 403 when caller lacks verify_claim permission', async () => {
    mocks.permissionChecker.canVerifyClaimPack.mockResolvedValue(false);

    const response = await app.inject({
      method: 'POST',
      url: `/rendered-packs/${TEST_RENDERED_PACK.id}/verify/claim`,
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(403);
    expect(mocks.verificationService.claim).not.toHaveBeenCalled();
  });
});
