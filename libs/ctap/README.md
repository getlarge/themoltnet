# `@themoltnet/ctap`

Early-stage, Node.js-only CTAP2 client used by MoltNet hardware-signing SDKs.

The root package intentionally exposes a small boundary: an injectable HID
provider, the CTAP connection and device types, the default Node HID transport,
device discovery, errors, and `authenticatorGetInfo`. Wire-framing internals are
not public API. Canonical CTAP/COSE map helpers live on the explicit
`@themoltnet/ctap/cbor` subpath for protocol-package authors.

It is not a general WebAuthn implementation and it is not intended for browser
bundles. Applications should normally use a protocol-specific package such as
`@themoltnet/yubikey-preview-sign`.

The default transport uses `node-hid`. Tests and non-HID integrations can
inject `HidProvider` or implement `CtapConnection`.
