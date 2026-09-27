import {
  AgentFingerprintConflictError,
  AgentIdentityKeyStaleError,
} from '@moltnet/database';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { registerStep, registerWorkflow } = vi.hoisted(() => ({
  registerStep: vi.fn((fn) => fn),
  registerWorkflow: vi.fn((fn) => fn),
}));

vi.mock('@moltnet/database', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  DBOS: { registerStep, registerWorkflow },
}));

import {
  type IdentityKeyRotationInput,
  identityKeyRotationWorkflow,
  initIdentityKeyRotationWorkflow,
  setIdentityKeyRotationDeps,
} from '../../src/workflows/identity-key-rotation-workflow.js';

const AGENT_ID = '550e8400-e29b-41d4-a716-446655440000';
const IDENTITY_ID = '550e8400-e29b-41d4-a716-4466554400ff';
const OLD_KEY = 'ed25519:old';
const NEW_KEY = 'ed25519:new';

const INPUT: IdentityKeyRotationInput = {
  agentId: AGENT_ID,
  identityId: IDENTITY_ID,
  currentPublicKey: OLD_KEY,
  newPublicKey: NEW_KEY,
  newFingerprint: 'NEW0-0000-0000-0000',
  proof: {
    message: 'moltnet:identity:rotate:v1\n...',
    previousPublicKey: OLD_KEY,
    previousKeySignature: 'old-sig',
    newKeySignature: 'new-sig',
  },
  clientIds: [`moltnet-agent-${AGENT_ID}`, 'legacy-client'],
};

function httpError(status: number) {
  return Object.assign(new Error(`HTTP ${status}`), {
    response: { status },
  });
}

describe('identity key rotation workflow', () => {
  const deps = {
    identityApi: { patchIdentity: vi.fn() },
    oauth2Api: { patchOAuth2Client: vi.fn(), deleteOAuth2Token: vi.fn() },
    agentRepository: { findById: vi.fn(), rotateIdentityKey: vi.fn() },
    agentIdentityKeyRepository: {
      attachRotationProof: vi.fn(),
      findByFingerprint: vi.fn(),
      listForAgent: vi.fn(),
    },
    transactionRunner: {
      runInTransaction: vi.fn((fn: () => Promise<unknown>) => fn()),
    },
    evictAuthCaches: vi.fn(),
    logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  };

  beforeAll(() => initIdentityKeyRotationWorkflow());

  beforeEach(() => {
    // Reset implementations too: tests run shuffled and set rejections.
    vi.resetAllMocks();
    deps.transactionRunner.runInTransaction.mockImplementation(
      (fn: () => Promise<unknown>) => fn(),
    );
    deps.agentRepository.findById.mockResolvedValue({
      id: AGENT_ID,
      publicKey: OLD_KEY,
      fingerprint: 'OLD0-0000-0000-0000',
    });
    deps.agentIdentityKeyRepository.attachRotationProof.mockResolvedValue(true);
    deps.oauth2Api.patchOAuth2Client.mockResolvedValue({});
    setIdentityKeyRotationDeps(deps as never);
  });

  it('rotates in Postgres, then reconciles Kratos, Hydra and caches', async () => {
    const result = await identityKeyRotationWorkflow.rotateIdentityKey(INPUT);

    expect(result).toEqual({
      status: 'rotated',
      agentId: AGENT_ID,
      publicKey: NEW_KEY,
      fingerprint: INPUT.newFingerprint,
      previousFingerprint: 'OLD0-0000-0000-0000',
    });
    expect(deps.agentRepository.rotateIdentityKey).toHaveBeenCalledWith({
      agentId: AGENT_ID,
      currentPublicKey: OLD_KEY,
      publicKey: NEW_KEY,
      fingerprint: INPUT.newFingerprint,
    });
    expect(
      deps.agentIdentityKeyRepository.attachRotationProof,
    ).toHaveBeenCalledWith(AGENT_ID, NEW_KEY, INPUT.proof);
    expect(deps.identityApi.patchIdentity).toHaveBeenCalledWith({
      id: IDENTITY_ID,
      jsonPatch: [
        { op: 'replace', path: '/traits/public_key', value: NEW_KEY },
      ],
    });
    for (const clientId of INPUT.clientIds) {
      expect(deps.oauth2Api.patchOAuth2Client).toHaveBeenCalledWith({
        id: clientId,
        jsonPatch: expect.arrayContaining([
          { op: 'add', path: '/metadata/public_key', value: NEW_KEY },
          {
            op: 'add',
            path: '/metadata/fingerprint',
            value: INPUT.newFingerprint,
          },
        ]),
      });
      expect(deps.oauth2Api.deleteOAuth2Token).toHaveBeenCalledWith({
        clientId,
      });
    }
    expect(deps.evictAuthCaches).toHaveBeenCalledWith({
      identityId: IDENTITY_ID,
      clientIds: INPUT.clientIds,
    });
  });

  it.each([
    ['stale', new AgentIdentityKeyStaleError(AGENT_ID)],
    ['conflict', new AgentFingerprintConflictError(INPUT.newFingerprint)],
  ])('returns %s without touching Ory', async (status, error) => {
    deps.agentRepository.rotateIdentityKey.mockRejectedValue(error);

    const result = await identityKeyRotationWorkflow.rotateIdentityKey(INPUT);

    expect(result).toEqual({ status });
    expect(
      deps.agentIdentityKeyRepository.attachRotationProof,
    ).not.toHaveBeenCalled();
    expect(deps.identityApi.patchIdentity).not.toHaveBeenCalled();
    expect(deps.oauth2Api.patchOAuth2Client).not.toHaveBeenCalled();
  });

  it('treats a replay of its own committed rotation as success', async () => {
    deps.agentRepository.findById.mockResolvedValue({
      id: AGENT_ID,
      publicKey: NEW_KEY,
      fingerprint: INPUT.newFingerprint,
    });
    deps.agentIdentityKeyRepository.findByFingerprint.mockResolvedValue({
      rotationProof: INPUT.proof,
    });
    deps.agentIdentityKeyRepository.listForAgent.mockResolvedValue([
      { publicKey: OLD_KEY, fingerprint: 'OLD0-0000-0000-0000' },
      { publicKey: NEW_KEY, fingerprint: INPUT.newFingerprint },
    ]);

    const result = await identityKeyRotationWorkflow.rotateIdentityKey(INPUT);

    expect(result).toMatchObject({
      status: 'rotated',
      previousFingerprint: 'OLD0-0000-0000-0000',
    });
    expect(deps.agentRepository.rotateIdentityKey).not.toHaveBeenCalled();
    expect(deps.identityApi.patchIdentity).toHaveBeenCalled();
  });

  it('does not claim a key moved by a different proof', async () => {
    deps.agentRepository.findById.mockResolvedValue({
      id: AGENT_ID,
      publicKey: NEW_KEY,
      fingerprint: INPUT.newFingerprint,
    });
    deps.agentIdentityKeyRepository.findByFingerprint.mockResolvedValue({
      rotationProof: { ...INPUT.proof, message: 'another proof' },
    });

    const result = await identityKeyRotationWorkflow.rotateIdentityKey(INPUT);

    expect(result).toEqual({ status: 'stale' });
    expect(deps.identityApi.patchIdentity).not.toHaveBeenCalled();
  });

  it('skips a missing Hydra client and an unbound identity', async () => {
    deps.oauth2Api.patchOAuth2Client
      .mockRejectedValueOnce(httpError(404))
      .mockResolvedValueOnce({});

    const result = await identityKeyRotationWorkflow.rotateIdentityKey({
      ...INPUT,
      identityId: null,
    });

    expect(result.status).toBe('rotated');
    expect(deps.identityApi.patchIdentity).not.toHaveBeenCalled();
    expect(deps.oauth2Api.deleteOAuth2Token).toHaveBeenCalledTimes(1);
    expect(deps.oauth2Api.deleteOAuth2Token).toHaveBeenCalledWith({
      clientId: 'legacy-client',
    });
  });

  it('logs the repair and fails when Ory reconciliation fails', async () => {
    deps.identityApi.patchIdentity.mockRejectedValue(httpError(503));

    await expect(
      identityKeyRotationWorkflow.rotateIdentityKey(INPUT),
    ).rejects.toThrow('HTTP 503');
    expect(deps.agentRepository.rotateIdentityKey).toHaveBeenCalled();
    expect(deps.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: AGENT_ID }),
      'identity.rotation.ory_reconciliation_exhausted',
    );
  });
});
