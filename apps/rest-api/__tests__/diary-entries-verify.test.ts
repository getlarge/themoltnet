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
const SIGNED_AT = new Date('2026-01-30T09:00:00Z');
// SIGNER_KEY signed the fixtures; OTHER_KEY is another key of the same agent,
// older or newer depending on the test.
const OTHER_KEY = 'ed25519:cm90YXRlZC1rZXk=';
const OTHER_FINGERPRINT = 'EEEE-EEEE-EEEE-EEEE';
// Distinct from the caller (OWNER_ID) so a test fails if verification reads
// the caller instead of the entry's creator.
const CREATOR_AGENT_ID = '770e8400-e29b-41d4-a716-446655440077';

const signedEntry = (overrides = {}) =>
  createMockEntry({
    content: CONTENT,
    contentHash: CONTENT_HASH,
    contentSignature: SIGNATURE,
    signingNonce: NONCE,
    creatorAgentId: CREATOR_AGENT_ID,
    createdAt: CREATED_AT,
    ...overrides,
  });

const creatorAgent = {
  id: CREATOR_AGENT_ID,
  identityId: '770e8400-e29b-41d4-a716-4466554400aa',
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
    mocks.signingRequestRepository.findValidBySignature.mockResolvedValue(null);
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
      signatureStatus: 'valid',
      valid: true,
      contentHash: CONTENT_HASH,
      agentFingerprint: SIGNER_FINGERPRINT,
    });
    expect(mocks.agentRepository.findById).toHaveBeenCalledWith(
      CREATOR_AGENT_ID,
    );
    expect(
      mocks.signingRequestRepository.findValidBySignature,
    ).toHaveBeenCalledWith(CONTENT_HASH, SIGNATURE);
  });

  it('ignores the Kratos identity recorded on the signing request (#2336)', async () => {
    mocks.diaryService.getEntryById.mockResolvedValue(signedEntry());
    // The identity was relinked: the request names an identity no agent has.
    mocks.signingRequestRepository.findValidBySignature.mockResolvedValue({
      agentId: '990e8400-e29b-41d4-a716-4466554400dd',
      nonce: NONCE,
      verificationMethod: 'agent-ed25519',
      signerPublicKey: null,
      completedAt: SIGNED_AT,
    });
    mocks.agentIdentityKeyRepository.findKeysValidBetween.mockResolvedValue([
      { publicKey: SIGNER_KEY, fingerprint: SIGNER_FINGERPRINT },
    ]);
    mocks.agentRepository.findByIdentityId.mockResolvedValue(null);

    const body = await verify();

    expect(body).toMatchObject({
      signatureStatus: 'valid',
      agentFingerprint: SIGNER_FINGERPRINT,
    });
  });

  it('uses the key recorded on the signing request when the agent rotated before creating the entry', async () => {
    mocks.diaryService.getEntryById.mockResolvedValue(signedEntry());
    mocks.agentRepository.findById.mockResolvedValue({
      ...creatorAgent,
      publicKey: OTHER_KEY,
      fingerprint: OTHER_FINGERPRINT,
    });
    mocks.signingRequestRepository.findValidBySignature.mockResolvedValue({
      nonce: NONCE,
      verificationMethod: 'agent-ed25519',
      signerPublicKey: SIGNER_KEY,
      completedAt: SIGNED_AT,
    });
    mocks.agentIdentityKeyRepository.listForAgent.mockResolvedValue([
      { publicKey: SIGNER_KEY, fingerprint: SIGNER_FINGERPRINT },
      { publicKey: OTHER_KEY, fingerprint: OTHER_FINGERPRINT },
    ]);
    // At entry creation only the rotated key was valid.
    mocks.agentIdentityKeyRepository.findKeysValidBetween.mockResolvedValue([
      { publicKey: OTHER_KEY, fingerprint: OTHER_FINGERPRINT },
    ]);

    const body = await verify();

    expect(body).toMatchObject({
      signatureStatus: 'valid',
      agentFingerprint: SIGNER_FINGERPRINT,
    });
  });

  it('verifies against the key the creator held when the entry was created', async () => {
    mocks.diaryService.getEntryById.mockResolvedValue(signedEntry());
    mocks.agentRepository.findById.mockResolvedValue({
      ...creatorAgent,
      publicKey: OTHER_KEY,
      fingerprint: OTHER_FINGERPRINT,
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
    ).toHaveBeenCalledWith(CREATOR_AGENT_ID, CREATED_AT, CREATED_AT);
  });

  it('rejects a signature by the current key when an older key was valid at creation', async () => {
    mocks.diaryService.getEntryById.mockResolvedValue(signedEntry());
    // The signature verifies under SIGNER_KEY, the agent's current key, but
    // the entry predates it.
    mocks.agentIdentityKeyRepository.findKeysValidBetween.mockResolvedValue([
      { publicKey: OTHER_KEY, fingerprint: OTHER_FINGERPRINT },
    ]);

    const body = await verify();

    expect(body).toMatchObject({ signatureStatus: 'invalid' });
    expect(mocks.cryptoService.verifyWithNonce).toHaveBeenCalledTimes(1);
  });

  it('reports a tampered signature as invalid with the creator fingerprint', async () => {
    mocks.diaryService.getEntryById.mockResolvedValue(
      signedEntry({ contentSignature: 'dGFtcGVyZWQ=' }),
    );

    const body = await verify();

    expect(body).toMatchObject({
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

  it('rejects a recorded signer key the creator never held', async () => {
    mocks.diaryService.getEntryById.mockResolvedValue(signedEntry());
    mocks.signingRequestRepository.findValidBySignature.mockResolvedValue({
      nonce: NONCE,
      verificationMethod: 'agent-ed25519',
      signerPublicKey: 'ed25519:Zm9yZWlnbi1rZXk=',
      completedAt: SIGNED_AT,
    });
    mocks.agentIdentityKeyRepository.listForAgent.mockResolvedValue([
      { publicKey: SIGNER_KEY, fingerprint: SIGNER_FINGERPRINT },
    ]);

    const body = await verify();

    expect(body).toMatchObject({ signatureStatus: 'invalid' });
    expect(mocks.cryptoService.verifyWithNonce).not.toHaveBeenCalled();
  });

  it('reports a hardware-key signing request as unresolved, not invalid', async () => {
    mocks.diaryService.getEntryById.mockResolvedValue(signedEntry());
    mocks.signingRequestRepository.findValidBySignature.mockResolvedValue({
      nonce: NONCE,
      verificationMethod: 'human-hardware-previewsign',
      signerPublicKey: null,
      completedAt: SIGNED_AT,
    });

    const body = await verify();

    expect(body).toMatchObject({ signatureStatus: 'signer_unresolved' });
    expect(mocks.cryptoService.verifyWithNonce).not.toHaveBeenCalled();
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
      signatureStatus: 'signer_unresolved',
      agentFingerprint: null,
    });
    expect(mocks.cryptoService.verifyWithNonce).not.toHaveBeenCalled();
  });

  describe('entries without a nonce on the row', () => {
    it('takes the nonce from the signing request', async () => {
      mocks.diaryService.getEntryById.mockResolvedValue(
        signedEntry({ signingNonce: null }),
      );
      mocks.signingRequestRepository.findValidBySignature.mockResolvedValue({
        nonce: NONCE,
        verificationMethod: 'agent-ed25519',
        signerPublicKey: null,
        completedAt: SIGNED_AT,
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

    it('prefers the nonce stored on the entry', async () => {
      mocks.diaryService.getEntryById.mockResolvedValue(signedEntry());
      mocks.signingRequestRepository.findValidBySignature.mockResolvedValue({
        nonce: '990e8400-e29b-41d4-a716-44665544ffff',
        verificationMethod: 'agent-ed25519',
        signerPublicKey: SIGNER_KEY,
        completedAt: SIGNED_AT,
      });

      await verify();

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
