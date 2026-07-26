import { p256 } from '@noble/curves/nist.js';
import { describe, expect, it } from 'vitest';

import vector from '../vectors/preview-sign-v1.json';
import { deriveArkgPublicKey } from './arkg.js';
import { createPreviewSignPrehash } from './digest.js';
import { verifyP256PrehashedSignature } from './p256-verify.js';
import type {
  CoseArkgSeedPublicMaterial,
  CoseEc2PublicKey,
} from './verify-types.js';

describe('published previewSign protocol vector', () => {
  it('contains only reusable previewSign and ARKG concepts', () => {
    expect(JSON.stringify(vector)).not.toMatch(
      /moltnet|teamId|claimantId|verificationMethod|signing-request/iu,
    );
  });

  it('reproduces derivation, prehashing, and ESP256 verification', () => {
    const derived = deriveArkgPublicKey(
      vector.seedPublicMaterial as CoseArkgSeedPublicMaterial,
      Buffer.from(vector.testOnly.ikm, 'base64url'),
      Buffer.from(vector.derivation.context, 'base64url'),
    );
    const digest = createPreviewSignPrehash(
      Buffer.from(vector.signing.payload, 'base64url'),
    );

    expect(Buffer.from(derived.additionalArguments).toString('base64url')).toBe(
      vector.derivation.additionalArguments,
    );
    expect(derived.publicKey).toEqual(vector.derivation.derivedPublicKey);
    expect(Buffer.from(digest).toString('base64url')).toBe(
      vector.signing.digest,
    );
    expect(
      verifyP256PrehashedSignature(
        digest,
        Buffer.from(vector.signing.signature, 'base64url'),
        vector.derivation.derivedPublicKey as CoseEc2PublicKey,
      ),
    ).toBe(true);
    expect(
      Buffer.from(
        p256.getPublicKey(
          Buffer.from(vector.testOnly.derivedPrivateKey, 'base64url'),
          false,
        ),
      ).toString('base64url'),
    ).toBe(
      Buffer.concat([
        Buffer.from([4]),
        Buffer.from(vector.derivation.derivedPublicKey.x, 'base64url'),
        Buffer.from(vector.derivation.derivedPublicKey.y, 'base64url'),
      ]).toString('base64url'),
    );
  });
});
