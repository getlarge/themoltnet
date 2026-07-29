import {
  buildExecutorClaimAttestationPayload,
  buildExecutorCompleteAttestationPayload,
  buildExecutorRegistrationAttestationPayload,
  canonicalJson,
  computeExecutorManifestCid,
  EXECUTOR_MANIFEST_SCHEMA_VERSION,
  type ExecutorTrustLevel,
  verifyExecutorAttestation,
} from '@moltnet/crypto-service';
import type {
  AgentRepository,
  Task as DbTask,
  TaskRepository,
} from '@moltnet/database';

import { TaskServiceError } from './task-service.shared.js';
import type {
  ExecutorAttestationInput,
  ExecutorRegistrationInput,
  VerifiedExecutorAttestation,
} from './task-service.types.js';
import { TRUST_LEVEL_TO_WIRE } from './wire-mappers.js';

const TRUST_ORDER: Record<ExecutorTrustLevel, number> = {
  selfDeclared: 0,
  agentSigned: 1,
  releaseVerifiedTool: 2,
  sandboxAttested: 3,
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

export function assertExecutorCompatibleWithRuntimeProfile(input: {
  executor: VerifiedExecutorAttestation | null;
  profile: {
    id: string;
    runtimeKind: string;
    definitionCid: string;
    requiredTools: readonly string[];
    requiredExecutables: readonly string[];
  };
}): void {
  if (!input.executor) {
    throw new TaskServiceError(
      'invalid',
      'Executor manifest is required when claiming with a runtime profile',
      [
        {
          field: 'executorFingerprint',
          message:
            'Register an executor manifest and claim with its fingerprint',
        },
      ],
    );
  }

  const manifestProfile = asRecord(input.executor.manifest.profile);
  if (manifestProfile?.id !== input.profile.id) {
    throw new TaskServiceError(
      'forbidden',
      'Executor manifest is not bound to the selected runtime profile',
    );
  }
  if (manifestProfile.definitionCid !== input.profile.definitionCid) {
    throw new TaskServiceError(
      'forbidden',
      'Executor manifest is not bound to the selected runtime profile revision',
    );
  }

  const manifestRuntime = asRecord(input.executor.manifest.runtime);
  if (manifestRuntime?.kind !== input.profile.runtimeKind) {
    throw new TaskServiceError(
      'forbidden',
      'Executor runtime kind does not match the selected runtime profile',
    );
  }

  const availableTools = new Set<string>();
  const manifestTools = input.executor.manifest.tools;
  if (Array.isArray(manifestTools)) {
    for (const value of manifestTools) {
      const tool = asRecord(value);
      if (typeof tool?.name === 'string') availableTools.add(tool.name);
    }
  }
  const manifestExtensions = input.executor.manifest.extensions;
  if (Array.isArray(manifestExtensions)) {
    for (const value of manifestExtensions) {
      const extension = asRecord(value);
      for (const name of asStringArray(extension?.declaredTools)) {
        availableTools.add(name);
      }
    }
  }
  const missingTools = input.profile.requiredTools.filter(
    (name) => !availableTools.has(name),
  );
  const availableExecutables = new Set(
    asStringArray(input.executor.manifest.executables),
  );
  const missingExecutables = input.profile.requiredExecutables.filter(
    (name) => !availableExecutables.has(name),
  );
  if (missingTools.length > 0 || missingExecutables.length > 0) {
    throw new TaskServiceError(
      'forbidden',
      'Executor manifest does not satisfy the selected runtime profile requirements',
      [
        ...missingTools.map((name) => ({
          field: 'executorManifest.tools',
          message: `Missing required tool: ${name}`,
        })),
        ...missingExecutables.map((name) => ({
          field: 'executorManifest.executables',
          message: `Missing required executable: ${name}`,
        })),
      ],
    );
  }
}

async function upsertAndAssertExecutorManifest(input: {
  executorManifest: Record<string, unknown>;
  executorFingerprint: string;
  taskRepository: TaskRepository;
}): Promise<void> {
  await input.taskRepository.upsertExecutorManifest({
    fingerprint: input.executorFingerprint,
    manifest: input.executorManifest,
    schemaVersion:
      typeof input.executorManifest.schemaVersion === 'string'
        ? input.executorManifest.schemaVersion
        : EXECUTOR_MANIFEST_SCHEMA_VERSION,
  });

  const stored = await input.taskRepository.findExecutorManifest(
    input.executorFingerprint,
  );
  if (
    stored &&
    canonicalJson(stored.manifest) !== canonicalJson(input.executorManifest)
  ) {
    throw new TaskServiceError(
      'conflict',
      'executorFingerprint already maps to a different manifest',
    );
  }
}

export async function registerExecutorManifest(input: {
  callerId: string;
  registration: ExecutorRegistrationInput;
  taskRepository: TaskRepository;
  agentRepository: AgentRepository;
}): Promise<{ executorFingerprint: string }> {
  const { executorManifest, executorFingerprint, executorSignature } =
    input.registration;
  let computed: string;
  try {
    computed = computeExecutorManifestCid(executorManifest);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new TaskServiceError('invalid', message, [
      { field: 'executorManifest', message },
    ]);
  }
  if (computed !== executorFingerprint) {
    throw new TaskServiceError(
      'invalid',
      'executorFingerprint does not match executorManifest',
      [
        {
          field: 'executorFingerprint',
          message: `Expected ${computed} for the supplied executorManifest`,
        },
      ],
    );
  }

  const agent = await input.agentRepository.findByIdentityId(input.callerId);
  if (!agent) throw new TaskServiceError('not_found', 'Agent not found');
  const valid = await verifyExecutorAttestation(
    buildExecutorRegistrationAttestationPayload({ executorFingerprint }),
    executorSignature,
    agent.publicKey,
  );
  if (!valid) {
    throw new TaskServiceError(
      'invalid',
      'executorSignature is not valid for executor registration',
      [
        {
          field: 'executorSignature',
          message: 'executorSignature verification failed',
        },
      ],
    );
  }

  await upsertAndAssertExecutorManifest({
    executorManifest,
    executorFingerprint,
    taskRepository: input.taskRepository,
  });
  await input.taskRepository.upsertExecutorManifestRegistration({
    fingerprint: executorFingerprint,
    agentIdentityId: input.callerId,
    signature: executorSignature,
  });
  await input.taskRepository.upsertExecutorManifestVerification({
    fingerprint: executorFingerprint,
    trustLevel: 'agent_signed',
    status: 'verified',
    evidence: { phase: 'register', signerAgentId: input.callerId },
  });

  return { executorFingerprint };
}

export async function verifyExecutorForPhase(input: {
  phase: 'claim' | 'complete';
  task: DbTask;
  callerId: string;
  attemptN: number | null;
  outputCid: string | null;
  attestation: ExecutorAttestationInput;
  taskRepository: TaskRepository;
  agentRepository: AgentRepository;
}): Promise<VerifiedExecutorAttestation | null> {
  const requiredTrustLevel =
    TRUST_LEVEL_TO_WIRE[input.task.requiredExecutorTrustLevel];
  const hasAny =
    input.attestation.executorManifest !== undefined ||
    input.attestation.executorFingerprint !== undefined ||
    input.attestation.executorSignature !== undefined;

  if (!hasAny) {
    if (requiredTrustLevel === 'selfDeclared') return null;
    throw new TaskServiceError(
      'invalid',
      `Executor attestation is required for trust level: ${requiredTrustLevel}`,
      [
        {
          field: 'executorManifest',
          message:
            'executorManifest, executorFingerprint, and executorSignature are required',
        },
      ],
    );
  }

  const { executorManifest, executorFingerprint, executorSignature } =
    input.attestation;
  if (
    input.phase === 'claim' &&
    executorFingerprint &&
    executorManifest === undefined &&
    executorSignature === undefined
  ) {
    if (TRUST_ORDER[requiredTrustLevel] >= TRUST_ORDER.releaseVerifiedTool) {
      throw new TaskServiceError(
        'invalid',
        `executor trust level '${requiredTrustLevel}' is not yet implemented`,
      );
    }
    const registration =
      await input.taskRepository.findExecutorManifestRegistration(
        executorFingerprint,
        input.callerId,
      );
    if (!registration) {
      throw new TaskServiceError(
        'invalid',
        'Executor fingerprint is not registered for the claiming agent',
        [
          {
            field: 'executorFingerprint',
            message:
              'Register the signed executor manifest before claiming by fingerprint',
          },
        ],
      );
    }
    const stored =
      await input.taskRepository.findExecutorManifest(executorFingerprint);
    if (!stored) {
      throw new TaskServiceError(
        'conflict',
        'Registered executor manifest could not be resolved',
      );
    }
    return {
      fingerprint: executorFingerprint,
      manifest: stored.manifest as Record<string, unknown>,
      verification: {
        trustLevel: 'agent_signed',
        evidence: { phase: 'register', signerAgentId: input.callerId },
      },
    };
  }
  if (!executorManifest || !executorFingerprint) {
    throw new TaskServiceError(
      'invalid',
      'executorManifest and executorFingerprint must be provided together',
      [
        {
          field: 'executorFingerprint',
          message:
            'executorManifest and executorFingerprint must be provided together',
        },
      ],
    );
  }

  let computed: string;
  try {
    computed = computeExecutorManifestCid(executorManifest);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new TaskServiceError('invalid', message, [
      { field: 'executorManifest', message },
    ]);
  }
  if (computed !== executorFingerprint) {
    throw new TaskServiceError(
      'invalid',
      'executorFingerprint does not match executorManifest',
      [
        {
          field: 'executorFingerprint',
          message: `Expected ${computed} for the supplied executorManifest`,
        },
      ],
    );
  }

  let verification: VerifiedExecutorAttestation['verification'];

  if (TRUST_ORDER[requiredTrustLevel] >= TRUST_ORDER.agentSigned) {
    if (!executorSignature) {
      throw new TaskServiceError(
        'invalid',
        'executorSignature is required for agentSigned executor trust',
        [
          {
            field: 'executorSignature',
            message: 'executorSignature is required',
          },
        ],
      );
    }
    const agent = await input.agentRepository.findByIdentityId(input.callerId);
    if (!agent) throw new TaskServiceError('not_found', 'Agent not found');
    const payload =
      input.phase === 'claim'
        ? buildExecutorClaimAttestationPayload({
            taskId: input.task.id,
            executorFingerprint,
          })
        : (() => {
            if (
              input.attemptN === null ||
              input.attemptN === undefined ||
              input.outputCid === null ||
              input.outputCid === undefined
            ) {
              throw new TaskServiceError(
                'invalid',
                'attemptN and outputCid are required for complete attestation verification',
              );
            }
            const attemptN = input.attemptN;
            const outputCid = input.outputCid;
            return buildExecutorCompleteAttestationPayload({
              taskId: input.task.id,
              attemptN,
              outputCid,
              executorFingerprint,
            });
          })();
    const valid = await verifyExecutorAttestation(
      payload,
      executorSignature,
      agent.publicKey,
    );
    if (!valid) {
      throw new TaskServiceError(
        'invalid',
        'executorSignature is not valid for the supplied executor attestation',
        [
          {
            field: 'executorSignature',
            message: 'executorSignature verification failed',
          },
        ],
      );
    }
    verification = {
      trustLevel: 'agent_signed',
      evidence: { phase: input.phase, signerAgentId: input.callerId },
    };
  }

  if (TRUST_ORDER[requiredTrustLevel] >= TRUST_ORDER.releaseVerifiedTool) {
    throw new TaskServiceError(
      'invalid',
      `executor trust level '${requiredTrustLevel}' is not yet implemented`,
      [
        {
          field: 'requiredExecutorTrustLevel',
          message: `${requiredTrustLevel} requires a verifier before claim acceptance`,
        },
      ],
    );
  }

  await upsertAndAssertExecutorManifest({
    executorManifest,
    executorFingerprint,
    taskRepository: input.taskRepository,
  });

  return {
    fingerprint: executorFingerprint,
    manifest: executorManifest,
    verification,
  };
}

export async function persistExecutorVerification(
  verified: VerifiedExecutorAttestation | null,
  taskRepository: TaskRepository,
): Promise<void> {
  if (!verified?.verification) return;
  await taskRepository.upsertExecutorManifestVerification({
    fingerprint: verified.fingerprint,
    trustLevel: verified.verification.trustLevel,
    status: 'verified',
    evidence: verified.verification.evidence,
  });
}

export function assertExecutorContinuity(input: {
  claimedFingerprint: string | null;
  completedFingerprint: string | null;
}): void {
  if (
    input.claimedFingerprint &&
    input.completedFingerprint !== input.claimedFingerprint
  ) {
    throw new TaskServiceError(
      'conflict',
      'Executor fingerprint changed between claim and completion',
      [
        {
          field: 'executorFingerprint',
          message:
            `Expected the claimed executor ${input.claimedFingerprint}, ` +
            `received ${input.completedFingerprint ?? 'no completion attestation'}`,
        },
      ],
    );
  }
}
