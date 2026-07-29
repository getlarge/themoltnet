import {
  buildExecutorRegistrationAttestationPayload,
  computeExecutorManifestCid,
  cryptoService,
  signExecutorAttestation,
} from '@moltnet/crypto-service';
import type { AgentRepository, Task, TaskRepository } from '@moltnet/database';
import { describe, expect, it, vi } from 'vitest';

import {
  assertExecutorCompatibleWithRuntimeProfile,
  assertExecutorContinuity,
  registerExecutorManifest,
  verifyExecutorForPhase,
} from './executor-attestation.js';

describe('assertExecutorCompatibleWithRuntimeProfile', () => {
  const profile = {
    id: '11111111-1111-4111-8111-111111111111',
    runtimeKind: 'custom_pi',
    definitionCid: 'bafkreiprofile',
    requiredTools: ['review', 'extension_tool'],
    requiredExecutables: ['git'],
  };

  it('accepts an executor prepared for the selected profile and runtime kind', () => {
    expect(() =>
      assertExecutorCompatibleWithRuntimeProfile({
        executor: {
          fingerprint: 'bafkrei-compatible',
          manifest: {
            profile: {
              id: profile.id,
              definitionCid: profile.definitionCid,
            },
            runtime: { kind: profile.runtimeKind },
            tools: [{ name: 'review' }],
            extensions: [{ declaredTools: ['extension_tool'] }],
            executables: ['git'],
          },
        },
        profile,
      }),
    ).not.toThrow();
  });

  it('requires executor evidence for profile-aware claims', () => {
    expect(() =>
      assertExecutorCompatibleWithRuntimeProfile({
        executor: null,
        profile,
      }),
    ).toThrow(/Executor manifest is required/);
  });

  it('rejects an executor prepared for another profile', () => {
    expect(() =>
      assertExecutorCompatibleWithRuntimeProfile({
        executor: {
          fingerprint: 'bafkrei-other-profile',
          manifest: {
            profile: {
              id: '22222222-2222-4222-8222-222222222222',
              definitionCid: profile.definitionCid,
            },
            runtime: { kind: profile.runtimeKind },
          },
        },
        profile,
      }),
    ).toThrow(/not bound to the selected runtime profile/);
  });

  it('rejects a runtime kind that does not satisfy the selected profile', () => {
    expect(() =>
      assertExecutorCompatibleWithRuntimeProfile({
        executor: {
          fingerprint: 'bafkrei-other-runtime',
          manifest: {
            profile: {
              id: profile.id,
              definitionCid: profile.definitionCid,
            },
            runtime: { kind: 'other_runtime' },
          },
        },
        profile,
      }),
    ).toThrow(/runtime kind does not match/);
  });

  it('rejects an executor prepared for another profile revision', () => {
    expect(() =>
      assertExecutorCompatibleWithRuntimeProfile({
        executor: {
          fingerprint: 'bafkrei-other-revision',
          manifest: {
            profile: { id: profile.id, definitionCid: 'bafkreiold' },
            runtime: { kind: profile.runtimeKind },
          },
        },
        profile,
      }),
    ).toThrow(/profile revision/);
  });

  it('rejects an executor missing required tools or executables', () => {
    expect(() =>
      assertExecutorCompatibleWithRuntimeProfile({
        executor: {
          fingerprint: 'bafkrei-missing-requirements',
          manifest: {
            profile: {
              id: profile.id,
              definitionCid: profile.definitionCid,
            },
            runtime: { kind: profile.runtimeKind },
            tools: [{ name: 'review' }],
            extensions: [],
            executables: [],
          },
        },
        profile,
      }),
    ).toThrow(/does not satisfy/);
  });
});

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

describe('verifyExecutorForPhase agent-signed enforcement', () => {
  const callerId = '11111111-1111-4111-8111-111111111111';
  const taskId = '22222222-2222-4222-8222-222222222222';
  const executorManifest = {
    schemaVersion: 'moltnet:executor-manifest:v1',
    runtime: { id: 'pi', version: '1' },
  };
  const executorFingerprint = computeExecutorManifestCid(executorManifest);

  it('rejects missing executor evidence when agent-signed trust is required', async () => {
    await expect(
      verifyExecutorForPhase({
        phase: 'claim',
        task: {
          id: taskId,
          requiredExecutorTrustLevel: 'agent_signed',
        } as Task,
        callerId,
        attemptN: null,
        outputCid: null,
        attestation: {},
        taskRepository: {} as TaskRepository,
        agentRepository: {} as AgentRepository,
      }),
    ).rejects.toThrow(/Executor attestation is required/);
  });

  it('rejects a manifest without the required executor signature', async () => {
    await expect(
      verifyExecutorForPhase({
        phase: 'claim',
        task: {
          id: taskId,
          requiredExecutorTrustLevel: 'agent_signed',
        } as Task,
        callerId,
        attemptN: null,
        outputCid: null,
        attestation: { executorManifest, executorFingerprint },
        taskRepository: {} as TaskRepository,
        agentRepository: {} as AgentRepository,
      }),
    ).rejects.toThrow(/executorSignature is required/);
  });

  it('rejects a tampered executor signature', async () => {
    const keys = await cryptoService.generateKeyPair();
    const upsertExecutorManifest = vi.fn();
    const taskRepository = {
      upsertExecutorManifest,
    } as unknown as TaskRepository;
    const agentRepository = {
      findByIdentityId: vi.fn().mockResolvedValue({
        identityId: callerId,
        publicKey: keys.publicKey,
      }),
    } as unknown as AgentRepository;

    await expect(
      verifyExecutorForPhase({
        phase: 'claim',
        task: {
          id: taskId,
          requiredExecutorTrustLevel: 'agent_signed',
        } as Task,
        callerId,
        attemptN: null,
        outputCid: null,
        attestation: {
          executorManifest,
          executorFingerprint,
          executorSignature: Buffer.alloc(64).toString('base64'),
        },
        taskRepository,
        agentRepository,
      }),
    ).rejects.toThrow(/executorSignature is not valid/);
    expect(upsertExecutorManifest).not.toHaveBeenCalled();
  });

  it('rejects a stored manifest that conflicts with its fingerprint', async () => {
    const taskRepository = {
      upsertExecutorManifest: vi.fn().mockResolvedValue(undefined),
      findExecutorManifest: vi.fn().mockResolvedValue({
        fingerprint: executorFingerprint,
        manifest: {
          schemaVersion: 'moltnet:executor-manifest:v1',
          runtime: { id: 'different', version: '1' },
        },
      }),
    } as unknown as TaskRepository;

    await expect(
      verifyExecutorForPhase({
        phase: 'claim',
        task: {
          id: taskId,
          requiredExecutorTrustLevel: 'self_declared',
        } as Task,
        callerId,
        attemptN: null,
        outputCid: null,
        attestation: { executorManifest, executorFingerprint },
        taskRepository,
        agentRepository: {} as AgentRepository,
      }),
    ).rejects.toThrow(
      /executorFingerprint already maps to a different manifest/,
    );
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
      manifest: executorManifest,
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
