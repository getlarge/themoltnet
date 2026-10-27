import { computeContentCid } from '@moltnet/crypto-service';
import type { FastifyInstance } from 'fastify';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  createMockEntry,
  createMockServices,
  createTestApp,
  ENTRY_ID,
  type MockServices,
  OWNER_ID,
  OWNER_IDENTITY_ID,
  TEST_BEARER_TOKEN,
  VALID_AUTH_CONTEXT,
} from './helpers.js';

const authHeaders = { authorization: `Bearer ${TEST_BEARER_TOKEN}` };

const CONTENT = 'Signed diary entry content';
const CONTENT_HASH = computeContentCid('semantic', null, CONTENT, null);
const SIGNATURE = 'c2lnbmF0dXJlLWZvci11bml0LXRlc3Q=';
const NONCE = '990e8400-e29b-41d4-a716-446655440009';
const SIGNER_KEY = 'ed25519:c2lnbmVyLWtleQ==';
const SIGNER_FINGERPRINT = 'AAAA-BBBB-CCCC-DDDD';
const CREATED_AT = new Date('2026-01-30T10:00:00Z');

const signedEntry = (overrides = {}) =>
  createMockEntry({
    content: CONTENT,
    contentHash: CONTENT_HASH,
    contentSignature: SIGNATURE,
    signingNonce: NONCE,
    createdAt: CREATED_AT,
    ...overrides,
  });

const creatorAgent = {
  id: OWNER_ID,
  identityId: OWNER_IDENTITY_ID,
  publicKey: SIGNER_KEY,
  fingerprint: SIGNER_FINGERPRINT,
};

describe('Diary entry routes - signature verification', () => {
  let app: FastifyInstance;
  let mocks: MockServices;

  const verify = async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/entries/${ENTRY_ID}/verify`,
      headers: authHeaders,
    });
    expect(response.statusCode).toBe(200);
    return response.json();
  };

  beforeAll(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks, VALID_AUTH_CONTEXT);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.agentRepository.findById.mockResolvedValue(creatorAgent);
    mocks.agentIdentityKeyRepository.findKeysValidBetween.mockResolvedValue([]);
    mocks.signingRequestRepository.findBySignature.mockResolvedValue(null);
    mocks.cryptoService.verifyWithNonce.mockImplementation(
      async (
        _message: string,
        _nonce: string,
        signature: string,
        key: string,
      ) => signature === SIGNATURE && key === SIGNER_KEY,
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('verifies against the creator key without the signing request or Kratos identity', async () => {
    mocks.diaryService.getEntryById.mockResolvedValue(signedEntry());

    const body = await verify();

    expect(body).toEqual({
      signed: true,
      hashMatches: true,
      signatureValid: true,
      signatureStatus: 'valid',
      valid: true,
      contentHash: CONTENT_HASH,
      agentFingerprint: SIGNER_FINGERPRINT,
    });
    expect(mocks.agentRepository.findById).toHaveBeenCalledWith(OWNER_ID);
    expect(
      mocks.signingRequestRepository.findBySignature,
    ).not.toHaveBeenCalled();
    expect(mocks.agentRepository.findByIdentityId).not.toHaveBeenCalled();
  });

  it('verifies against the key the creator held when the entry was created', async () => {
    mocks.diaryService.getEntryById.mockResolvedValue(signedEntry());
    mocks.agentRepository.findById.mockResolvedValue({
      ...creatorAgent,
      publicKey: 'ed25519:cm90YXRlZC1rZXk=',
      fingerprint: 'EEEE-EEEE-EEEE-EEEE',
    });
    mocks.agentIdentityKeyRepository.findKeysValidBetween.mockResolvedValue([
      { publicKey: SIGNER_KEY, fingerprint: SIGNER_FINGERPRINT },
    ]);

    const body = await verify();

    expect(body).toMatchObject({
      signatureStatus: 'valid',
      agentFingerprint: SIGNER_FINGERPRINT,
    });
    expect(
      mocks.agentIdentityKeyRepository.findKeysValidBetween,
    ).toHaveBeenCalledWith(OWNER_ID, CREATED_AT, CREATED_AT);
  });

  it('reports a tampered signature as invalid with the creator fingerprint', async () => {
    mocks.diaryService.getEntryById.mockResolvedValue(
      signedEntry({ contentSignature: 'dGFtcGVyZWQ=' }),
    );

    const body = await verify();

    expect(body).toMatchObject({
      signatureValid: false,
      signatureStatus: 'invalid',
      valid: false,
      agentFingerprint: SIGNER_FINGERPRINT,
    });
  });

  it('reports tampered content as a hash mismatch', async () => {
    mocks.diaryService.getEntryById.mockResolvedValue(
      signedEntry({ content: 'Edited afterwards' }),
    );

    const body = await verify();

    expect(body).toMatchObject({
      hashMatches: false,
      signatureStatus: 'valid',
      valid: false,
    });
  });

  it('reports a human-created entry as unresolved, not invalid', async () => {
    mocks.diaryService.getEntryById.mockResolvedValue(
      signedEntry({
        creatorAgentId: null,
        creatorHumanId: '660e8400-e29b-41d4-a716-446655440001',
      }),
    );

    const body = await verify();

    expect(body).toMatchObject({
      signatureValid: false,
      signatureStatus: 'signer_unresolved',
      agentFingerprint: null,
    });
    expect(mocks.cryptoService.verifyWithNonce).not.toHaveBeenCalled();
  });

  it('reports a missing creator agent as unresolved, not invalid', async () => {
    mocks.diaryService.getEntryById.mockResolvedValue(signedEntry());
    mocks.agentRepository.findById.mockResolvedValue(null);

    const body = await verify();

    expect(body).toMatchObject({ signatureStatus: 'signer_unresolved' });
  });

  describe('entries without a nonce on the row', () => {
    it('takes the nonce from the signing request', async () => {
      mocks.diaryService.getEntryById.mockResolvedValue(
        signedEntry({ signingNonce: null }),
      );
      mocks.signingRequestRepository.findBySignature.mockResolvedValue({
        nonce: NONCE,
      });

      const body = await verify();

      expect(body).toMatchObject({ signatureStatus: 'valid' });
      expect(mocks.cryptoService.verifyWithNonce).toHaveBeenCalledWith(
        CONTENT_HASH,
        NONCE,
        SIGNATURE,
        SIGNER_KEY,
      );
    });

    it('reports unresolved when the signing request is gone too', async () => {
      mocks.diaryService.getEntryById.mockResolvedValue(
        signedEntry({ signingNonce: null }),
      );

      const body = await verify();

      expect(body).toMatchObject({ signatureStatus: 'signer_unresolved' });
      expect(mocks.cryptoService.verifyWithNonce).not.toHaveBeenCalled();
    });
  });

  it('reports an unsigned entry as unsigned', async () => {
    mocks.diaryService.getEntryById.mockResolvedValue(createMockEntry());

    const body = await verify();

    expect(body).toMatchObject({ signed: false, signatureStatus: 'unsigned' });
  });
});
