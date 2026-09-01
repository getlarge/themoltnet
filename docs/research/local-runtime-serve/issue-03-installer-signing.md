# [#2063] feat(packaging): one-line installer + signed macOS bundle for `moltnet-agent`

> #2063 — the operational runbook lives in
> [macos-signing-and-packaging-plan.md](../macos-signing-and-packaging-plan.md)
> (written to be driven step-by-step by a dedicated agent session).
> Apple Developer Program enrollment started 2026-09-01.

## Summary

Eliminate every manual install: ship `moltnet-agent` (with `serve`) as a
self-contained, signed, notarized payload — bundled Node runtime,
`gondolin-krun-runner` + `libkrun.dylib`, static `qemu-img` — installed via
`curl -fsSL https://get.themolt.net | sh`, later a `.pkg`. Signing is also the
Keychain trust fix: ACLs bind to the requester's code signature, so a
MoltNet-signed binary makes prompts say "MoltNet Agent" and locks out system
`node`.

## Deliverables

1. **yao-pkg spike (timeboxed 1 d)**: CJS bundle target for the `serve`
   entry → `pkg` single binary; native addons + vendor binaries as sidecars;
   sign the patched-Node output with hardened runtime + JIT entitlements.
   Fallback on failure: `runtime/node` folder layout (re-signed stock Node).
2. **Payload assembly** in release CI (`macos-latest`), per
   `packages/cli`'s per-platform-package precedent; linux-x64 tarball
   (unsigned) from the same job matrix.
3. **Signing + notarization** exactly per the runbook: inside-out codesign of
   every Mach-O, preserved entitlements (`hypervisor` on the krun runner —
   already embedded ad-hoc today; JIT pair on node), `notarytool` + staple.
4. **Installer script** (`get.themolt.net`): checksum-verified download →
   `~/.local/share/moltnet/` → `moltnet-agent` on PATH → LaunchAgent for
   `serve`. Idempotent, `--uninstall` flag.
5. **Self-healing**: `serve` verifies components at boot and re-downloads
   missing/corrupt ones (pattern: `sandbox-gondolin/snapshot.ts`'s `gh`/CLI
   fetch).
6. **Keyring migration switch**: when running as the signed bundle, `serve`
   migrates `file:` refs to `os-keyring:` (same canonical keys) and flips the
   default backend.

## Acceptance

- [ ] Fresh macOS arm64 machine, one `curl | sh`: `serve` running at login,
      Gatekeeper-clean, no Node/qemu preinstalled.
- [ ] Keychain acceptance test from the runbook (prompt names MoltNet; bare
      `node` denied; Go CLI interop round-trip still passes).
- [ ] `spctl -a -vv` + `codesign --verify --strict` clean on every Mach-O.
- [ ] Linux tarball path works headless (no keyring, file store).

## Budget

$99/yr Apple. ~1 week engineering after enrollment clears (breakdown in the
runbook).
