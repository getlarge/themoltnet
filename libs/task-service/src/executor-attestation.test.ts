import {
  buildExecutorRegistrationAttestationPayload,
  computeExecutorManifestCid,
  cryptoService,
  signExecutorAttestation,
} from '@moltnet/crypto-service';
import type { AgentRepository, Task, TaskRepository } from '@moltnet/database';
import { describe, expect, it, vi } from 'vitest';

import {
  assertExecutorContinuity,
  registerExecutorManifest,
  verifyExecutorForPhase,
} from './executor-attestation.js';

describe('assertExecutorContinuity', () => {
  it('accepts the executor claimed by the attempt', () => {
    expect(() =>
      assertExecutorContinuity({
        claimedFingerprint: 'bafkrei-claimed',
        completedFingerprint: 'bafkrei-claimed',
      }),
    ).not.toThrow();
  });

  it('rejects executor drift after claim', () => {
    expect(() =>
      assertExecutorContinuity({
        claimedFingerprint: 'bafkrei-claimed',
        completedFingerprint: 'bafkrei-other',
      }),
    ).toThrow(/changed between claim and completion/);
  });

  it('allows unattested self-declared attempts', () => {
    expect(() =>
      assertExecutorContinuity({
        claimedFingerprint: null,
        completedFingerprint: null,
      }),
    ).not.toThrow();
  });
});

describe('registered executor manifests', () => {
  it('allows claims to reference one agent-signed registration', async () => {
    const callerId = '11111111-1111-4111-8111-111111111111';
    const keys = await cryptoService.generateKeyPair();
    const executorManifest = {
      schemaVersion: 'moltnet:executor-manifest:v1',
      runtime: { id: 'pi', version: '1' },
    };
    const executorFingerprint = computeExecutorManifestCid(executorManifest);
    const executorSignature = await signExecutorAttestation(
      buildExecutorRegistrationAttestationPayload({ executorFingerprint }),
      keys.privateKey,
    );
    const manifests = new Map<string, Record<string, unknown>>();
    const registrations = new Set<string>();
    const upsertExecutorManifest = vi
      .fn<
        (input: {
          fingerprint: string;
          manifest: Record<string, unknown>;
        }) => Promise<void>
      >()
      .mockImplementation(({ fingerprint, manifest }) => {
        manifests.set(fingerprint, manifest);
        return Promise.resolve();
      });
    const upsertExecutorManifestRegistration = vi
      .fn<
        (input: {
          fingerprint: string;
          agentIdentityId: string;
        }) => Promise<void>
      >()
      .mockImplementation(({ fingerprint, agentIdentityId }) => {
        registrations.add(`${fingerprint}:${agentIdentityId}`);
        return Promise.resolve();
      });
    const taskRepository = {
      upsertExecutorManifest,
      findExecutorManifest: vi.fn((fingerprint: string) =>
        Promise.resolve(
          manifests.has(fingerprint)
            ? { fingerprint, manifest: manifests.get(fingerprint) }
            : null,
        ),
      ),
      upsertExecutorManifestRegistration,
      findExecutorManifestRegistration: vi.fn(
        (fingerprint: string, agentIdentityId: string) =>
          Promise.resolve(
            registrations.has(`${fingerprint}:${agentIdentityId}`)
              ? { fingerprint, agentIdentityId }
              : null,
          ),
      ),
      upsertExecutorManifestVerification: vi.fn().mockResolvedValue(undefined),
    } as unknown as TaskRepository;
    const agentRepository = {
      findByIdentityId: vi.fn((identityId: string) =>
        Promise.resolve(
          identityId === callerId
            ? { identityId, publicKey: keys.publicKey }
            : null,
        ),
      ),
    } as unknown as AgentRepository;

    await registerExecutorManifest({
      callerId,
      registration: {
        executorManifest,
        executorFingerprint,
        executorSignature,
      },
      taskRepository,
      agentRepository,
    });
    const verified = await verifyExecutorForPhase({
      phase: 'claim',
      task: {
        id: '22222222-2222-4222-8222-222222222222',
        requiredExecutorTrustLevel: 'agent_signed',
      } as Task,
      callerId,
      attemptN: null,
      outputCid: null,
      attestation: { executorFingerprint },
      taskRepository,
      agentRepository,
    });

    expect(verified).toEqual({
      fingerprint: executorFingerprint,
      verification: {
        trustLevel: 'agent_signed',
        evidence: { phase: 'register', signerAgentId: callerId },
      },
    });
    expect(upsertExecutorManifestRegistration).toHaveBeenCalledOnce();
  });

  it('rejects a fingerprint registered by a different agent', async () => {
    const taskRepository = {
      findExecutorManifestRegistration: vi.fn().mockResolvedValue(null),
    } as unknown as TaskRepository;

    await expect(
      verifyExecutorForPhase({
        phase: 'claim',
        task: {
          id: '22222222-2222-4222-8222-222222222222',
          requiredExecutorTrustLevel: 'agent_signed',
        } as Task,
        callerId: '33333333-3333-4333-8333-333333333333',
        attemptN: null,
        outputCid: null,
        attestation: { executorFingerprint: 'bafkrei-registered' },
        taskRepository,
        agentRepository: {} as AgentRepository,
      }),
    ).rejects.toThrow(/not registered for the claiming agent/);
  });
});
