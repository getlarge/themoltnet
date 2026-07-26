import type {
  PreviewSignChallenge,
  PreviewSignPublicMaterial,
  PreviewSignReceiptValue,
} from '@moltnet/api-client';
import { p256 } from '@noble/curves/nist.js';
import { deriveArkgPrivateKeyForTesting } from '@themoltnet/yubikey-preview-sign/test-support';

const BLINDING_SECRET = new Uint8Array(32).fill(7);
const KEM_SECRET = new Uint8Array(32).fill(8);
const OUTER_SECRET = new Uint8Array(32).fill(9);

function ec2<const Algorithm extends -25 | -7>(
  secret: Uint8Array,
  algorithm: Algorithm,
) {
  const point = p256.getPublicKey(secret, false);
  return {
    kty: 2 as const,
    algorithm,
    curve: 1 as const,
    x: Buffer.from(point.slice(1, 33)).toString('base64url'),
    y: Buffer.from(point.slice(33)).toString('base64url'),
  };
}

export function previewSignTestPublicMaterial(): PreviewSignPublicMaterial {
  return {
    version: 1,
    outerCredentialId: Buffer.from('e2e-preview-sign-outer').toString(
      'base64url',
    ),
    outerPublicKey: ec2(OUTER_SECRET, -7),
    previewKeyHandle: Buffer.from('e2e-preview-sign-key').toString('base64url'),
    seedPublicKey: {
      kty: -65537,
      algorithm: -65700,
      derivedAlgorithm: -9,
      blindingKey: ec2(BLINDING_SECRET, -7),
      kemKey: ec2(KEM_SECRET, -25),
    },
  };
}

function derivedPrivateKey(additionalArguments: string): Uint8Array {
  return deriveArkgPrivateKeyForTesting({
    blindingSecret: BLINDING_SECRET,
    kemSecret: KEM_SECRET,
    additionalArguments: Buffer.from(additionalArguments, 'base64url'),
  });
}

export function signPreviewSignChallenge(
  challenge: PreviewSignChallenge,
): PreviewSignReceiptValue {
  const digest = Buffer.from(challenge.digest, 'base64url');
  if (digest.length !== 32) {
    throw new Error('previewSign server challenge digest is not 32 bytes');
  }
  const signature = p256.sign(
    digest,
    derivedPrivateKey(challenge.additionalArguments),
    {
      format: 'der',
      prehash: false,
      lowS: true,
    },
  );
  return {
    verificationMethod: 'human-hardware-previewsign',
    value: {
      version: 1,
      signature: Buffer.from(signature).toString('base64url'),
    },
  };
}
