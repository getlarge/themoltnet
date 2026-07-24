import { p256 } from '@noble/curves/nist.js';

import { concatBytes, fromBase64Url, sha256 } from './bytes.js';
import { invariant, PreviewSignError } from './errors.js';
import type { CoseEc2PublicKey } from './verify-types.js';

function ecPoint(key: CoseEc2PublicKey): Uint8Array {
  invariant(
    key.kty === 2 && key.curve === 1,
    'VERIFICATION_FAILED',
    'Expected a P-256 EC2 key',
  );
  const x = fromBase64Url(key.x, 'EC x-coordinate');
  const y = fromBase64Url(key.y, 'EC y-coordinate');
  invariant(
    x.length === 32 && y.length === 32,
    'VERIFICATION_FAILED',
    'Invalid P-256 coordinate length',
  );
  return concatBytes(Uint8Array.of(4), x, y);
}

function verifyDigest(
  digest: Uint8Array,
  signature: Uint8Array,
  publicKey: CoseEc2PublicKey,
): boolean {
  p256.Signature.fromBytes(signature, 'der');
  return p256.verify(signature, digest, ecPoint(publicKey), {
    format: 'der',
    prehash: false,
    lowS: true,
  });
}

/**
 * Canonicalizes authenticator-produced DER signatures before they cross the
 * SDK boundary. Authenticators may emit high-S ECDSA, but callers only receive
 * and verify the unique low-S representation.
 */
export function normalizeP256DerSignature(signature: Uint8Array): Uint8Array {
  try {
    const parsed = p256.Signature.fromBytes(signature, 'der');
    return parsed.hasHighS()
      ? new p256.Signature(
          parsed.r,
          p256.Point.CURVE().n - parsed.s,
          parsed.recovery,
        ).toBytes('der')
      : Uint8Array.from(signature);
  } catch (error) {
    throw new PreviewSignError(
      'VERIFICATION_FAILED',
      'Invalid DER-encoded P-256 signature',
      undefined,
      { cause: error },
    );
  }
}

export function verifyP256Signature(
  message: Uint8Array,
  signature: Uint8Array,
  publicKey: CoseEc2PublicKey,
): boolean {
  try {
    return verifyDigest(
      sha256(message),
      normalizeP256DerSignature(signature),
      publicKey,
    );
  } catch (error) {
    throw new PreviewSignError(
      'VERIFICATION_FAILED',
      'Unable to verify P-256 signature',
      undefined,
      { cause: error },
    );
  }
}

export function verifyP256PrehashedSignature(
  digest: Uint8Array,
  signature: Uint8Array,
  publicKey: CoseEc2PublicKey,
): boolean {
  try {
    invariant(
      digest.length === 32,
      'VERIFICATION_FAILED',
      'Digest must be 32 bytes',
    );
    return verifyDigest(digest, signature, publicKey);
  } catch (error) {
    if (error instanceof PreviewSignError) throw error;
    throw new PreviewSignError(
      'VERIFICATION_FAILED',
      'Unable to verify prehashed P-256 signature',
      undefined,
      { cause: error },
    );
  }
}
