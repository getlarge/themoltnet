import { cryptoService, type KeyPair } from '@moltnet/crypto-service';
import { buildIdentityKeyRotationMessage } from '@moltnet/models';
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

const { mockStartWorkflow, mockGetResult } = vi.hoisted(() => ({
  mockStartWorkflow: vi.fn(),
  mockGetResult: vi.fn(),
}));

vi.mock('@moltnet/database', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  DBOS: {
    startWorkflow: mockStartWorkflow,
    registerStep: (fn: unknown) => fn,
    registerWorkflow: (fn: unknown) => fn,
  },
}));

import { initIdentityKeyRotationWorkflow } from '../src/workflows/index.js';
import {
  createMockAgent,
  createMockServices,
  createTestApp,
  HUMAN_AUTH_CONTEXT,
  type MockServices,
  OWNER_ID,
  OWNER_IDENTITY_ID,
  resetMockServices,
  VALID_AUTH_CONTEXT,
} from './helpers.js';

describe('POST /auth/rotate-identity-key', () => {
  let app: FastifyInstance;
  let mocks: MockServices;
  let current: KeyPair;
  let next: KeyPair;
  let workflowInput: Record<string, unknown> | undefined;

  beforeAll(async () => {
    initIdentityKeyRotationWorkflow();
    mocks = createMockServices();
    app = await createTestApp(mocks, VALID_AUTH_CONTEXT);
    current = await cryptoService.generateKeyPair();
    next = await cryptoService.generateKeyPair();
  });

  afterAll(async () => app.close());

  beforeEach(() => {
    resetMockServices(mocks);
    // Real Ed25519: the proof must verify exactly as it would in production.
    mocks.cryptoService.parsePublicKey.mockImplementation((key: string) =>
      cryptoService.parsePublicKey(key),
    );
    mocks.cryptoService.generateFingerprint.mockImplementation(
      (bytes: Uint8Array) => cryptoService.generateFingerprint(bytes),
    );
    mocks.cryptoService.verify.mockImplementation(
      (message: string, signature: string, publicKey: string) =>
        cryptoService.verify(message, signature, publicKey),
    );
    mocks.agentRepository.findById.mockResolvedValue(
      createMockAgent({
        id: OWNER_ID,
        identityId: OWNER_IDENTITY_ID,
        publicKey: current.publicKey,
        fingerprint: current.fingerprint,
      }),
    );
    mocks.agentRepository.findByFingerprint.mockResolvedValue(null);
    workflowInput = undefined;
    mockGetResult.mockReset().mockImplementation(async () => ({
      status: 'rotated',
      agentId: OWNER_ID,
      publicKey: next.publicKey,
      fingerprint: next.fingerprint,
      previousFingerprint: current.fingerprint,
    }));
    mockStartWorkflow.mockReset().mockImplementation(() =>
      vi.fn(async (input: Record<string, unknown>) => {
        workflowInput = input;
        return { getResult: mockGetResult };
      }),
    );
  });

  async function proofFor(
    overrides: {
      issuedAt?: string;
      signCurrentWith?: KeyPair;
      signNewWith?: KeyPair;
      newKey?: KeyPair;
    } = {},
  ) {
    const newKey = overrides.newKey ?? next;
    const issuedAt = overrides.issuedAt ?? new Date().toISOString();
    const message = buildIdentityKeyRotationMessage({
      agentId: OWNER_ID,
      currentPublicKey: current.publicKey,
      newPublicKey: newKey.publicKey,
      issuedAt,
    });
    return {
      message,
      body: {
        newPublicKey: newKey.publicKey,
        issuedAt,
        previousKeySignature: await cryptoService.sign(
          message,
          (overrides.signCurrentWith ?? current).privateKey,
        ),
        newKeySignature: await cryptoService.sign(
          message,
          (overrides.signNewWith ?? newKey).privateKey,
        ),
      },
    };
  }

  const rotate = (payload: unknown, target: FastifyInstance = app) =>
    target.inject({
      method: 'POST',
      url: '/auth/rotate-identity-key',
      headers: { authorization: 'Bearer test-token' },
      payload: payload as Record<string, unknown>,
    });

  it('rotates with a proof signed by both keys', async () => {
    const { body, message } = await proofFor();

    const response = await rotate(body);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      agentId: OWNER_ID,
      publicKey: next.publicKey,
      fingerprint: next.fingerprint,
      previousFingerprint: current.fingerprint,
    });
    expect(workflowInput).toEqual({
      agentId: OWNER_ID,
      identityId: OWNER_IDENTITY_ID,
      currentPublicKey: current.publicKey,
      newPublicKey: next.publicKey,
      newFingerprint: next.fingerprint,
      proof: {
        message,
        previousPublicKey: current.publicKey,
        previousKeySignature: body.previousKeySignature,
        newKeySignature: body.newKeySignature,
      },
      clientIds: [`moltnet-agent-${OWNER_ID}`, VALID_AUTH_CONTEXT.clientId],
    });
    expect(mockStartWorkflow).toHaveBeenCalledWith(expect.any(Function), {
      workflowID: expect.stringMatching(
        new RegExp(`^identity-rotation-${OWNER_ID}-[0-9a-f]{32}$`),
      ),
    });
  });

  it('builds the message from the stored key, not the token claims', async () => {
    // VALID_AUTH_CONTEXT.publicKey is a different key; the proof is built
    // against the database row and must verify.
    const { body } = await proofFor();
    expect(VALID_AUTH_CONTEXT).not.toMatchObject({
      publicKey: current.publicKey,
    });

    expect((await rotate(body)).statusCode).toBe(200);
  });

  it.each([
    ['the current key', { signCurrentWith: undefined as KeyPair | undefined }],
    ['the new key', { signNewWith: undefined as KeyPair | undefined }],
  ])('rejects a proof not signed by %s', async (_name, which) => {
    const stranger = await cryptoService.generateKeyPair();
    const overrides =
      'signCurrentWith' in which
        ? { signCurrentWith: stranger }
        : { signNewWith: stranger };
    const { body } = await proofFor(overrides);

    const response = await rotate(body);

    expect(response.statusCode).toBe(400);
    expect(response.json().type).toContain('invalid-signature');
    expect(mockStartWorkflow).not.toHaveBeenCalled();
  });

  it('rejects a proof issued outside the allowed window', async () => {
    const { body } = await proofFor({
      issuedAt: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
    });

    const response = await rotate(body);

    expect(response.statusCode).toBe(400);
    expect(response.json().detail).toContain('issuedAt');
    expect(mockStartWorkflow).not.toHaveBeenCalled();
  });

  it('rejects a key that is not 32 bytes', async () => {
    const { body } = await proofFor();

    const response = await rotate({
      ...body,
      newPublicKey: 'ed25519:c2hvcnQ=',
    });

    expect(response.statusCode).toBe(400);
    expect(mockStartWorkflow).not.toHaveBeenCalled();
  });

  it.each([
    ['a short signature', { previousKeySignature: 'c2hvcnQ=' }],
    ['a non-base64 signature', { newKeySignature: '!'.repeat(88) }],
    ['a non-date issuedAt', { issuedAt: 'yesterday' }],
  ])('rejects %s at the request schema', async (_case, change) => {
    const { body } = await proofFor();

    const response = await rotate({ ...body, ...change });

    expect(response.statusCode).toBe(400);
    expect(mocks.agentRepository.findById).not.toHaveBeenCalled();
    expect(mockStartWorkflow).not.toHaveBeenCalled();
  });

  it('rejects a new key that is already or was previously registered', async () => {
    const { body } = await proofFor();
    mocks.agentIdentityKeyRepository.findByFingerprint.mockResolvedValue({
      agentId: 'another-agent',
      fingerprint: next.fingerprint,
    });

    const response = await rotate(body);

    expect(response.statusCode).toBe(409);
    expect(mockStartWorkflow).not.toHaveBeenCalled();
  });

  it.each([
    ['stale', 'current identity key changed'],
    ['conflict', 'already, or was previously, registered'],
  ])('maps a %s workflow result to 409', async (status, detail) => {
    const { body } = await proofFor();
    mockGetResult.mockResolvedValue({ status });

    const response = await rotate(body);

    expect(response.statusCode).toBe(409);
    expect(response.json().detail).toContain(detail);
  });

  it('reports a failed workflow as an upstream error', async () => {
    const { body } = await proofFor();
    mockGetResult.mockRejectedValue(new Error('hydra unavailable'));

    const response = await rotate(body);

    expect(response.statusCode).toBe(502);
    expect(response.json().detail).toContain('/agents/whoami');
  });

  it.each([
    ['a team-bound agent key', 'team', 403],
    ['an identity-scoped agent key', 'identity', 200],
  ] as const)('with %s answers %i', async (_name, bindingScope, status) => {
    const keyApp = await createTestApp(mocks, {
      ...VALID_AUTH_CONTEXT,
      credentialBinding:
        bindingScope === 'team'
          ? {
              bindingScope: 'team',
              keyId: 'key-1',
              expiresAt: null,
              boundTeamId: '990e8400-e29b-41d4-a716-446655440009',
            }
          : { bindingScope: 'identity', keyId: 'key-1', expiresAt: null },
    });
    try {
      const { body } = await proofFor();
      const response = await rotate(body, keyApp);
      expect(response.statusCode).toBe(status);
      if (status === 403) {
        expect(mockStartWorkflow).not.toHaveBeenCalled();
      }
    } finally {
      await keyApp.close();
    }
  });

  it('refuses humans', async () => {
    const humanApp = await createTestApp(mocks, HUMAN_AUTH_CONTEXT);
    try {
      const { body } = await proofFor();
      const response = await rotate(body, humanApp);
      expect(response.statusCode).toBe(403);
      expect(mockStartWorkflow).not.toHaveBeenCalled();
    } finally {
      await humanApp.close();
    }
  });
});
