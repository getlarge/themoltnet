import {
  buildExecutorClaimAttestationPayload,
  buildExecutorCompleteAttestationPayload,
  buildExecutorRegistrationAttestationPayload,
  computeExecutorManifestCid,
  signExecutorAttestation,
} from '@moltnet/crypto-service';

import { readConfig } from './credentials.js';

export interface ExecutorAttestationFields {
  executorManifest: Record<string, unknown>;
  executorFingerprint: string;
  executorSignature: string;
}

export interface ExecutorClaimReference {
  executorFingerprint: string;
}

export interface ExecutorAttestor {
  readonly manifest: Record<string, unknown>;
  readonly fingerprint: string;
  registration(): Promise<ExecutorAttestationFields>;
  reference(): ExecutorClaimReference;
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
  let registrationPromise: Promise<ExecutorAttestationFields> | undefined;

  return {
    manifest,
    fingerprint,
    registration() {
      registrationPromise ??= (async () => {
        const executorSignature = await signExecutorAttestation(
          buildExecutorRegistrationAttestationPayload({
            executorFingerprint: fingerprint,
          }),
          privateKey,
        );
        return {
          executorManifest: manifest,
          executorFingerprint: fingerprint,
          executorSignature,
        };
      })();
      return registrationPromise;
    },
    reference() {
      return { executorFingerprint: fingerprint };
    },
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
