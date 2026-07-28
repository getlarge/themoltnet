import {
  buildExecutorClaimAttestationPayload,
  buildExecutorCompleteAttestationPayload,
  computeExecutorManifestCid,
  signExecutorAttestation,
} from '@moltnet/crypto-service';

import { readConfig } from './credentials.js';

export interface ExecutorAttestationFields {
  executorManifest: Record<string, unknown>;
  executorFingerprint: string;
  executorSignature: string;
}

export interface ExecutorAttestor {
  readonly manifest: Record<string, unknown>;
  readonly fingerprint: string;
  claim(taskId: string): Promise<ExecutorAttestationFields>;
  complete(input: {
    taskId: string;
    attemptN: number;
    outputCid: string;
  }): Promise<ExecutorAttestationFields>;
}

/**
 * Bind a deterministic executor manifest to the active MoltNet agent key.
 *
 * The returned signatures use the server's existing task-executor
 * attestation framing and can be spread directly into claim/complete bodies.
 */
export async function createExecutorAttestor(input: {
  manifest: Record<string, unknown>;
  configDir: string;
}): Promise<ExecutorAttestor> {
  const config = await readConfig(input.configDir);
  if (!config) {
    throw new Error(
      `Cannot attest executor manifest: no MoltNet config in ${input.configDir}`,
    );
  }
  const manifest = structuredClone(input.manifest);
  const fingerprint = computeExecutorManifestCid(manifest);
  const privateKey = config.keys.private_key;

  return {
    manifest,
    fingerprint,
    async claim(taskId) {
      const executorSignature = await signExecutorAttestation(
        buildExecutorClaimAttestationPayload({
          taskId,
          executorFingerprint: fingerprint,
        }),
        privateKey,
      );
      return {
        executorManifest: manifest,
        executorFingerprint: fingerprint,
        executorSignature,
      };
    },
    async complete({ taskId, attemptN, outputCid }) {
      const executorSignature = await signExecutorAttestation(
        buildExecutorCompleteAttestationPayload({
          taskId,
          attemptN,
          outputCid,
          executorFingerprint: fingerprint,
        }),
        privateKey,
      );
      return {
        executorManifest: manifest,
        executorFingerprint: fingerprint,
        executorSignature,
      };
    },
  };
}
