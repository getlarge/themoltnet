import { computeContentCid } from '@moltnet/crypto-service';
import { VERIFICATION_METHOD } from '@moltnet/models';
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
  DIARY_ID,
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
const SIGNING_REQUEST_ID = 'aa0e8400-e29b-41d4-a716-44665544000a';

const signedEntry = (overrides = {}) =>
  createMockEntry({
    content: CONTENT,
    contentHash: CONTENT_HASH,
    contentSignature: SIGNATURE,
    signingNonce: NONCE,
    ...overrides,
  });

const recordedSigner = {
  signerAgentId: OWNER_ID,
  signerPublicKey: SIGNER_KEY,
  signerFingerprint: SIGNER_FINGERPRINT,
};

const completedRequest = (overrides = {}) => ({
  id: SIGNING_REQUEST_ID,
  agentId: OWNER_IDENTITY_ID,
  verificationMethod: VERIFICATION_METHOD.AgentEd25519,
  message: CONTENT_HASH,
  nonce: NONCE,
  status: 'completed',
  signature: SIGNATURE,
  valid: true,
  signerPublicKey: SIGNER_KEY,
  completedAt: new Date('2026-01-30T10:00:00Z'),
  ...overrides,
});

const signerAgent = {
  id: OWNER_ID,
  identityId: OWNER_IDENTITY_ID,
  publicKey: SIGNER_KEY,
  fingerprint: SIGNER_FINGERPRINT,
};

describe('Diary entry routes - signature verification', () => {
  let app: FastifyInstance;
  let mocks: MockServices;

  const verify = () =>
    app.inject({
      method: 'GET',
      url: `/entries/${ENTRY_ID}/verify`,
      headers: authHeaders,
    });

  beforeAll(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks, VALID_AUTH_CONTEXT);
  });

  beforeEach(() => {
    vi.clearAllMocks();
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

  describe('with a recorded signer', () => {
    it('verifies without the signing request or an identity lookup', async () => {
      mocks.diaryService.getEntryById.mockResolvedValue(
        signedEntry(recordedSigner),
      );

      const response = await verify();

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        signed: true,
        hashMatches: true,
        signatureValid: true,
        signatureStatus: 'valid',
        valid: true,
        contentHash: CONTENT_HASH,
        agentFingerprint: SIGNER_FINGERPRINT,
      });
      expect(
        mocks.signingRequestRepository.findBySignature,
      ).not.toHaveBeenCalled();
      expect(mocks.agentRepository.findByIdentityId).not.toHaveBeenCalled();
    });

    it('reports a tampered signature as invalid with known provenance', async () => {
      mocks.diaryService.getEntryById.mockResolvedValue(
        signedEntry({ ...recordedSigner, contentSignature: 'dGFtcGVyZWQ=' }),
      );

      const body = (await verify()).json();

      expect(body).toMatchObject({
        signatureValid: false,
        signatureStatus: 'invalid',
        valid: false,
        agentFingerprint: SIGNER_FINGERPRINT,
      });
    });

    it('reports tampered content as a hash mismatch', async () => {
      mocks.diaryService.getEntryById.mockResolvedValue(
        signedEntry({ ...recordedSigner, content: 'Edited afterwards' }),
      );

      const body = (await verify()).json();

      expect(body).toMatchObject({
        hashMatches: false,
        signatureStatus: 'valid',
        valid: false,
      });
    });
  });

  describe('without a recorded signer (legacy entries)', () => {
    it('reports an unavailable signing request as unresolved, not invalid', async () => {
      mocks.diaryService.getEntryById.mockResolvedValue(signedEntry());
      mocks.signingRequestRepository.findBySignature.mockResolvedValue(null);

      const body = (await verify()).json();

      expect(body).toMatchObject({
        signatureValid: false,
        signatureStatus: 'signer_unresolved',
        valid: false,
        agentFingerprint: null,
      });
      expect(mocks.cryptoService.verifyWithNonce).not.toHaveBeenCalled();
    });

    it('reports a relinked identity as unresolved, not invalid', async () => {
      mocks.diaryService.getEntryById.mockResolvedValue(signedEntry());
      mocks.signingRequestRepository.findBySignature.mockResolvedValue(
        completedRequest(),
      );
      mocks.agentRepository.findByIdentityId.mockResolvedValueOnce(null);

      const body = (await verify()).json();

      expect(body).toMatchObject({
        signatureStatus: 'signer_unresolved',
        agentFingerprint: null,
      });
    });

    it('verifies through the signing request when it resolves', async () => {
      mocks.diaryService.getEntryById.mockResolvedValue(signedEntry());
      mocks.signingRequestRepository.findBySignature.mockResolvedValue(
        completedRequest(),
      );
      mocks.agentRepository.findByIdentityId.mockResolvedValueOnce(signerAgent);

      const body = (await verify()).json();

      expect(body).toMatchObject({
        signatureStatus: 'valid',
        valid: true,
        agentFingerprint: SIGNER_FINGERPRINT,
      });
    });

    it('reports a rejected signature as invalid once the signer resolves', async () => {
      mocks.diaryService.getEntryById.mockResolvedValue(signedEntry());
      mocks.signingRequestRepository.findBySignature.mockResolvedValue(
        completedRequest(),
      );
      mocks.agentRepository.findByIdentityId.mockResolvedValueOnce(signerAgent);
      mocks.cryptoService.verifyWithNonce.mockResolvedValue(false);

      const body = (await verify()).json();

      expect(body).toMatchObject({
        signatureStatus: 'invalid',
        agentFingerprint: SIGNER_FINGERPRINT,
      });
    });
  });

  it('reports an unsigned entry as unsigned', async () => {
    mocks.diaryService.getEntryById.mockResolvedValue(createMockEntry());

    const body = (await verify()).json();

    expect(body).toMatchObject({ signed: false, signatureStatus: 'unsigned' });
  });

  describe(`POST /diaries/${DIARY_ID}/entries with a signing request`, () => {
    const createSigned = () =>
      app.inject({
        method: 'POST',
        url: `/diaries/${DIARY_ID}/entries`,
        headers: authHeaders,
        payload: { content: CONTENT, signingRequestId: SIGNING_REQUEST_ID },
      });

    beforeEach(() => {
      mocks.diaryService.createEntry.mockResolvedValue(
        signedEntry(recordedSigner),
      );
    });

    it('records the agent key that verified the signature', async () => {
      mocks.signingRequestRepository.findById.mockResolvedValue(
        completedRequest(),
      );
      mocks.agentRepository.findByIdentityId.mockResolvedValue(signerAgent);

      const response = await createSigned();

      expect(response.statusCode).toBe(201);
      expect(mocks.diaryService.createEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          contentSignature: SIGNATURE,
          signingNonce: NONCE,
          signer: {
            agentId: OWNER_ID,
            publicKey: SIGNER_KEY,
            fingerprint: SIGNER_FINGERPRINT,
          },
        }),
        expect.anything(),
        expect.anything(),
      );
    });

    it('records no signer when no agent key verifies the signature', async () => {
      mocks.signingRequestRepository.findById.mockResolvedValue(
        completedRequest(),
      );
      mocks.agentRepository.findByIdentityId.mockResolvedValue(signerAgent);
      mocks.cryptoService.verifyWithNonce.mockResolvedValue(false);

      const response = await createSigned();

      expect(response.statusCode).toBe(201);
      expect(mocks.diaryService.createEntry).toHaveBeenCalledWith(
        expect.objectContaining({ signer: undefined }),
        expect.anything(),
        expect.anything(),
      );
    });
  });
});
