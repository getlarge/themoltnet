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
application prefix, wire-version marker, or CBOR envelope. The deprecated
`createPreviewSignDigestV1` name remains as an alias for compatibility.
`signDigest` accepts exactly 32 bytes and the YubiKey signs those bytes as-is;
the offline verifier therefore does not hash them again.

Authenticator-produced ECDSA signatures are canonicalized to low-S before the
SDK returns them. The standalone verifier rejects non-canonical high-S forms,
so signature bytes have one stable representation.

Each signature derives a fresh ESP256 child key from the enrolled ARKG seed.

The package publishes a deterministic, application-neutral interoperability
vector at
`@themoltnet/yubikey-preview-sign/vectors/preview-sign-v1.json`. It covers ARKG
public-key derivation, the exact previewSign prehash, and ESP256 verification.
Values under `testOnly` are fixed secrets for reproducing the vector and must
never be used as enrollment or production key material.

Applications own their signing envelope, identity model, authorization,
lifecycle, persistence, and replay policy. Production server integrations
generate fresh IKM, persist the derived public key and verifier-only state, and
send only the public ARKG additional arguments to the authenticator. IKM must
not cross the application boundary in a challenge, receipt, or evidence record.
