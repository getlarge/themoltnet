# `@themoltnet/yubikey-preview-sign`

Experimental SDK for Yubico's draft `previewSign` extension on compatible
YubiKey firmware. This package is early access and must not be treated as a
production-stable signing protocol.

The root export is Node.js-only because it discovers authenticators through
`@themoltnet/ctap` and `node-hid`. The explicit `./verify` export is
isomorphic:

```ts
import {
  createPreviewSignPrehash,
  verifyP256PrehashedSignature,
} from '@themoltnet/yubikey-preview-sign/verify';
```

`createPreviewSignPrehash(payload)` is exactly SHA-256 of `payload`. It adds no
MoltNet prefix, wire-version marker, or CBOR envelope. The deprecated
`createPreviewSignDigestV1` name remains as an alias for compatibility.
`signDigest` accepts exactly 32 bytes and the YubiKey signs those bytes as-is;
the offline verifier therefore does not hash them again.

Authenticator-produced ECDSA signatures are canonicalized to low-S before the
SDK returns them. The standalone verifier rejects non-canonical high-S forms,
so signature bytes have one stable representation.

Each signature derives a fresh ESP256 child key from the enrolled ARKG seed.
The returned verification-key record carries the IKM, context, derived public
key, and additional arguments needed to reproduce and audit that derivation.
MoltNet server envelopes and workflow integration belong to later initiative
phases and are intentionally outside this library.
