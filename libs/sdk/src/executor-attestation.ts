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
  assertSigningPrivateKey(input.signingPrivateKey);
  const manifest = structuredClone(input.manifest);
  const fingerprint = computeExecutorManifestCid(manifest);
  const privateKey = input.signingPrivateKey;
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

function assertSigningPrivateKey(value: string): void {
  const normalized = value.trim();
  const bytes = Buffer.from(normalized, 'base64');
  const canonical = bytes.toString('base64');
  if (
    normalized.length === 0 ||
    bytes.length !== 32 ||
    canonical !== normalized
  ) {
    throw new Error(
      'Cannot attest executor manifest: signingPrivateKey must be a base64-encoded 32-byte Ed25519 private key.',
    );
  }
}
