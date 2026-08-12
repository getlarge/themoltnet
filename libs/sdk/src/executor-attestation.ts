import {
  buildExecutorClaimAttestationPayload,
  buildExecutorCompleteAttestationPayload,
  buildExecutorRegistrationAttestationPayload,
  computeExecutorManifestCid,
  signExecutorAttestation,
} from '@moltnet/crypto-service';

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
export function createExecutorAttestor(input: {
  manifest: Record<string, unknown>;
  signingPrivateKey: string;
}): ExecutorAttestor {
  const privateKey = normalizeSigningPrivateKey(input.signingPrivateKey);
  const manifest = structuredClone(input.manifest);
  const fingerprint = computeExecutorManifestCid(manifest);
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

function normalizeSigningPrivateKey(value: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(normalized)) {
    throwInvalidSigningPrivateKey();
  }
  const bytes = Buffer.from(normalized, 'base64');
  if (bytes.length !== 32) {
    throwInvalidSigningPrivateKey();
  }
  return bytes.toString('base64');
}

function throwInvalidSigningPrivateKey(): never {
  throw new Error(
    'Cannot attest executor manifest: signingPrivateKey must be a base64-encoded 32-byte Ed25519 private key.',
  );
}
