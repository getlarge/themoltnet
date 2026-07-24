# YubiKey signer demo

Disposable Phase 1 hardware smoke. This is intentionally not the future
`apps/moltnet-signer` and may be deleted when the production signer work starts.

With a previewSign-capable YubiKey connected:

```bash
pnpm exec nx run @moltnet/yubikey-signer-demo:smoke
```

The command enrolls one ARKG seed, asks for two fresh signatures, asserts that
their verification-key IDs and public keys differ, and verifies both offline.
Unverified local enrollment is opted into explicitly for this development-only
gate.
