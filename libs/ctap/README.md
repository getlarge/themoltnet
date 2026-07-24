# `@themoltnet/ctap`

Early-stage, Node.js-only CTAP2 client used by MoltNet hardware-signing SDKs.

The package intentionally exposes a small boundary: CTAP HID framing, canonical
CBOR for CTAP/COSE maps, `authenticatorGetInfo`, and an injectable transport
interface. It is not a general WebAuthn implementation and it is not intended
for browser bundles. Applications should normally use a protocol-specific
package such as `@themoltnet/yubikey-preview-sign`.

The default transport uses `node-hid`. Tests and non-HID integrations can
inject `HidProvider` or implement `CtapConnection`.
