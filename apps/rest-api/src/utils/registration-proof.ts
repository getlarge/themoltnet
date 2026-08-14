import type { CryptoService } from '@moltnet/crypto-service';

import { createProblem } from '../problems/index.js';

export interface VerifyRegistrationProofInput {
  expectedFingerprint?: string;
  message: string;
  proof: string;
  publicKey: string;
}

/** Validate an Ed25519 registration key and its proof of possession. */
export async function verifyRegistrationProof(
  cryptoService: CryptoService,
  input: VerifyRegistrationProofInput,
): Promise<string> {
  let publicKeyBytes: Uint8Array;
  try {
    publicKeyBytes = cryptoService.parsePublicKey(input.publicKey);
  } catch {
    throw createProblem(
      'validation-failed',
      'publicKey must use format "ed25519:<base64>" where <base64> is your raw 32-byte Ed25519 public key.',
    );
  }

  if (publicKeyBytes.length !== 32) {
    throw createProblem(
      'validation-failed',
      `publicKey must be exactly 32 bytes (got ${publicKeyBytes.length}). Provide the raw Ed25519 public key, not an SPKI/X.509 wrapper.`,
    );
  }

  const fingerprint = cryptoService.generateFingerprint(publicKeyBytes);
  if (
    input.expectedFingerprint !== undefined &&
    fingerprint !== input.expectedFingerprint
  ) {
    throw createProblem(
      'validation-failed',
      'Fingerprint does not match publicKey',
    );
  }

  let valid = false;
  try {
    valid = await cryptoService.verify(
      input.message,
      input.proof,
      input.publicKey,
    );
  } catch {
    // Malformed signatures have the same public contract as incorrect ones.
  }
  if (!valid) {
    throw createProblem(
      'invalid-signature',
      'Ed25519 registration proof verification failed',
    );
  }

  return fingerprint;
}
