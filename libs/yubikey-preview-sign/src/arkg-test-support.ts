import { p256 } from '@noble/curves/nist.js';
import { asMap, decodeCbor, mapBytes, mapNumber } from '@themoltnet/ctap/cbor';

import { ESP256_SPLIT_ARKG_PLACEHOLDER } from './arkg.js';
import {
  DST_BL,
  DST_BL_EC,
  DST_DERIVE_KEY_BL,
  DST_DERIVE_KEY_KEM,
  DST_KEM,
  DST_KEM_HMAC_SHARED,
  hashToScalar,
  hkdfSha256,
  P256_ORDER,
} from './arkg-core.js';
import { bigintToBytes, bytesToBigint, concatBytes } from './bytes.js';
import { invariant } from './errors.js';

/**
 * Reconstruct the private half of a derived ARKG key for the software-only
 * REST E2E authenticator.
 *
 * This workspace-only subpath is absent from publishConfig.exports and every
 * production build entry. It must never receive production seed material.
 */
export function deriveArkgPrivateKeyForTesting(input: {
  blindingSecret: Uint8Array;
  kemSecret: Uint8Array;
  additionalArguments: Uint8Array;
}): Uint8Array {
  invariant(
    input.blindingSecret.length === 32 && input.kemSecret.length === 32,
    'INVALID_INPUT',
    'ARKG test seed secrets must contain exactly 32 bytes',
  );
  const args = asMap(
    decodeCbor(input.additionalArguments),
    'ARKG additional arguments',
  );
  invariant(
    mapNumber(args, 3, 'ARKG derived algorithm') ===
      ESP256_SPLIT_ARKG_PLACEHOLDER,
    'INVALID_RESPONSE',
    'Unexpected ARKG derived algorithm',
  );
  const keyHandle = mapBytes(args, -1, 'ARKG key handle');
  const context = mapBytes(args, -2, 'ARKG context');
  invariant(
    keyHandle.length === 81 && context.length <= 64,
    'INVALID_RESPONSE',
    'Invalid ARKG additional arguments',
  );
  const sharedSecret = p256
    .getSharedSecret(input.kemSecret, keyHandle.slice(16), true)
    .slice(1);
  const contextPrime = concatBytes(Uint8Array.of(context.length), context);
  const kemContext = concatBytes(DST_DERIVE_KEY_KEM, contextPrime);
  const ikmTau = hkdfSha256(
    sharedSecret,
    concatBytes(DST_KEM_HMAC_SHARED, DST_KEM, kemContext),
    sharedSecret.length,
  );
  const tau = hashToScalar(
    ikmTau,
    concatBytes(
      DST_BL_EC,
      DST_BL,
      concatBytes(DST_DERIVE_KEY_BL, contextPrime),
    ),
  );
  const privateScalar =
    (bytesToBigint(input.blindingSecret) + tau) % P256_ORDER;
  invariant(
    privateScalar !== 0n,
    'INVALID_RESPONSE',
    'ARKG derived an invalid zero private scalar',
  );
  return bigintToBytes(privateScalar, 32);
}
