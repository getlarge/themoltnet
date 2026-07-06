import {
  buildExecutorClaimAttestationPayload,
  buildExecutorCompleteAttestationPayload,
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
  VerifiedExecutorAttestation,
} from './task-service.types.js';
import { TRUST_LEVEL_TO_WIRE } from './wire-mappers.js';

const TRUST_ORDER: Record<ExecutorTrustLevel, number> = {
  selfDeclared: 0,
  agentSigned: 1,
  releaseVerifiedTool: 2,
  sandboxAttested: 3,
};

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

  await input.taskRepository.upsertExecutorManifest({
    fingerprint: executorFingerprint,
    manifest: executorManifest,
    schemaVersion:
      typeof executorManifest.schemaVersion === 'string'
        ? executorManifest.schemaVersion
        : EXECUTOR_MANIFEST_SCHEMA_VERSION,
  });

  const stored =
    await input.taskRepository.findExecutorManifest(executorFingerprint);
  if (
    stored &&
    canonicalJson(stored.manifest) !== canonicalJson(executorManifest)
  ) {
    throw new TaskServiceError(
      'conflict',
      'executorFingerprint already maps to a different manifest',
    );
  }

  return { fingerprint: executorFingerprint, verification };
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
