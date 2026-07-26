import type {
  BeginPreviewSignCredentialRegistration,
  CompletePreviewSignCredentialRegistration,
  CompletePreviewSignRequest,
  PreviewSignArkgSeedPublicKey,
  PreviewSignChallenge,
  PreviewSignChallengeValue,
  PreviewSignEcdhEsHkdf256PublicKey,
  PreviewSignEs256PublicKey,
  PreviewSignEsp256PublicKey,
  PreviewSignEvidence,
  PreviewSignEvidenceValue,
  PreviewSignPublicMaterial,
  PreviewSignReceipt,
  PreviewSignReceiptValue,
} from '@moltnet/api-client';
import { p256 } from '@noble/curves/nist.js';

export type {
  BeginPreviewSignCredentialRegistration,
  CompletePreviewSignCredentialRegistration,
  CompletePreviewSignRequest,
  PreviewSignArkgSeedPublicKey,
  PreviewSignChallenge,
  PreviewSignChallengeValue,
  PreviewSignEcdhEsHkdf256PublicKey,
  PreviewSignEs256PublicKey,
  PreviewSignEsp256PublicKey,
  PreviewSignEvidence,
  PreviewSignEvidenceValue,
  PreviewSignPublicMaterial,
  PreviewSignReceipt,
  PreviewSignReceiptValue,
};

export const PREVIEW_SIGN_VERIFICATION_METHOD =
  'human-hardware-previewsign' as const;
export const PREVIEW_SIGN_CREDENTIAL_TYPE = 'preview-sign-arkg' as const;
export const PREVIEW_SIGN_ALGORITHM = 'arkg-p256-esp256' as const;

export interface DecodedPreviewSignChallenge {
  envelope: Uint8Array;
  digest: Uint8Array;
  additionalArguments: Uint8Array;
  outerCredentialId: Uint8Array;
  previewKeyHandle: Uint8Array;
}

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;

function decodeBase64Url(value: string, field: string): Uint8Array {
  if (!value || !BASE64URL_PATTERN.test(value) || value.includes('=')) {
    throw new TypeError(`${field} must be canonical unpadded base64url`);
  }
  const base64 = value
    .replaceAll('-', '+')
    .replaceAll('_', '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = globalThis.atob(base64);
  const decoded = Uint8Array.from(binary, (character) =>
    character.charCodeAt(0),
  );
  if (encodeBase64Url(decoded) !== value) {
    throw new TypeError(`${field} must be canonical unpadded base64url`);
  }
  return decoded;
}

function encodeBase64Url(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return globalThis
    .btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

/**
 * Decode the opaque byte fields needed by a local previewSign companion.
 *
 * This helper performs no HID or device access and does not accept alternate
 * signing bytes. The exact 32-byte server digest is returned unchanged.
 */
export function decodePreviewSignChallenge(
  challenge: PreviewSignChallenge,
): DecodedPreviewSignChallenge {
  if (
    challenge.verificationMethod !== PREVIEW_SIGN_VERIFICATION_METHOD ||
    challenge.version !== 1
  ) {
    throw new TypeError('Unsupported previewSign challenge');
  }
  const digest = decodeBase64Url(challenge.digest, 'challenge.digest');
  if (digest.length !== 32) {
    throw new TypeError('challenge.digest must contain exactly 32 bytes');
  }
  return {
    envelope: decodeBase64Url(challenge.envelope, 'challenge.envelope'),
    digest,
    additionalArguments: decodeBase64Url(
      challenge.additionalArguments,
      'challenge.additionalArguments',
    ),
    outerCredentialId: decodeBase64Url(
      challenge.outerCredentialId,
      'challenge.outerCredentialId',
    ),
    previewKeyHandle: decodeBase64Url(
      challenge.previewKeyHandle,
      'challenge.previewKeyHandle',
    ),
  };
}

/** Wrap an authenticator-produced DER ESP256 signature for the API. */
export function createPreviewSignReceipt(
  signature: Uint8Array | string,
): PreviewSignReceiptValue {
  const encoded =
    typeof signature === 'string' ? signature : encodeBase64Url(signature);
  const decoded = decodeBase64Url(encoded, 'signature');
  if (decoded.length < 8 || decoded.length > 72 || decoded[0] !== 0x30) {
    throw new TypeError('signature must be a DER-encoded ESP256 signature');
  }
  let parsed: ReturnType<typeof p256.Signature.fromBytes>;
  try {
    parsed = p256.Signature.fromBytes(decoded, 'der');
  } catch {
    throw new TypeError('signature must be a DER-encoded ESP256 signature');
  }
  const normalized = parsed.hasHighS()
    ? new p256.Signature(
        parsed.r,
        p256.Point.CURVE().n - parsed.s,
        parsed.recovery,
      ).toBytes('der')
    : decoded;
  return {
    verificationMethod: PREVIEW_SIGN_VERIFICATION_METHOD,
    value: { version: 1, signature: encodeBase64Url(normalized) },
  };
}
