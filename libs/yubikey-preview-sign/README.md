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

The `./protocol` export is for production server drivers. It exposes ARKG
public-key derivation, digest construction, and prehashed verification without
loading the HID transport:

```ts
import {
  deriveArkgPublicKey,
  verifyP256PrehashedSignature,
} from '@themoltnet/yubikey-preview-sign/protocol';
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

The package publishes the deterministic Phase 3 server interoperability vector
at `@themoltnet/yubikey-preview-sign/vectors/preview-sign-server-v1.json`. Its
`serverTestOnly` and `authenticatorTestOnly` fields are fixed test secrets for
reproducing ARKG derivation and must never be used as enrollment material.
Production callers generate fresh IKM server-side, persist only the derived
public key and verifier state, and return only the public additional arguments.
IKM is never part of the public challenge, enrollment material, verifier state,
receipt, or normalized evidence. The canonical server envelope and lifecycle
are documented in the
[MoltNet signing architecture guide](https://github.com/getlarge/themoltnet/blob/main/docs/understand/signing.md).
