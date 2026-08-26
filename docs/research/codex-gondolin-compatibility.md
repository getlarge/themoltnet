# Codex remote execution in Gondolin

This private compatibility spike tests whether Codex can keep its App Server,
authentication, model traffic, and host tools on the trusted host while running
model-requested shell commands through an exec-server inside Gondolin. The
probe also exercises purpose-bound host credential use: the guest can request a
host-authenticated MoltNet identity check and Git signature without receiving
the OAuth client secret or signing key.

It does not introduce a public runtime contract. Codex's remote-environment API
and `externalSandbox` policy remain experimental, so the retained result is
evidence for issue #1980 rather than a production compatibility promise.

## Run the probe

The probe currently pins Codex 0.149.0, Gondolin 0.12.0, a macOS ARM64 host,
and a Linux ARM64 guest. The released host `codex` binary must match the pin.
The probe downloads `@openai/codex@0.149.0-linux-arm64`, cross-compiles the
workspace CLI for the guest, verifies both Codex binaries, performs one
low-effort model turn, and deletes the binaries and temporary workspace after
the VM closes. The Nx target launches the Node probe through the released
`moltnet start` command. The CLI—not Node—resolves the activated OAuth binding
from the host secret provider before launch. Run the target from a host shell
that permits the released CLI to access that provider.

```bash
pnpm exec nx run @moltnet/tools:codex-environment-gondolin
```

Set `MOLTNET_CODEX_BIN` only to select the host Codex executable. Set
`MOLTNET_CODEX_PROBE_DEBUG=1` to forward host and guest server diagnostics.
Neither setting is persisted in evidence.

The retained JSON records only versions, package integrity, readiness and
completion states, fixed markers, environment-variable names matching the
credential heuristic, and cleanup results. It rejects prompts, transcripts,
thread/environment identifiers, machine paths, token-like strings, private
keys, and registered synthetic values.

## What a passing result means

A pass establishes that:

- the Codex environment changes from pending to ready;
- the model's command runs through the Linux guest exec-server;
- the model's guest command invokes a boolean-only, host-authenticated
  `whoami` capability after verifying the binding delivered by `moltnet start`;
- `git commit -S` in the guest is signed by the operation-scoped host signer,
  while an ungranted diary-signing operation is denied;
- a host-only sentinel is absent from the guest environment;
- no signing key, private-key file, or `.moltnet` credential directory is
  projected into the guest;
- no credential-shaped environment names appear in the guest;
- closing the VM prevents a detached delayed write; and
- the relay created exactly one guest exec-server for its WebSocket.

`thread/shellCommand` is intentionally not used: it is a user-initiated,
host-local operation. Only the model tool path exercises the selected remote
environment.

This proves Codex compatibility with MoltNet's existing host-capability signing
and host-authentication boundary. It does not prove generic exact-origin HTTP
credential delivery, Docker cancellation, a public Codex adapter, or that guest
code may read raw host secrets. Those remain separately gated.

## Credential preflight reasons

Credential failures must describe the boundary that actually failed:

| Reason                         | Meaning                                                   |
| ------------------------------ | --------------------------------------------------------- |
| `required_binding_missing`     | The required logical credential has no binding.           |
| `binding_requirement_mismatch` | The binding targets another requirement.                  |
| `resolution_boundary_denied`   | Guest code tried to resolve a host credential.            |
| `destination_denied`           | The requested destination is not allowed.                 |
| `provider_unavailable`         | The configured provider is unavailable.                   |
| `host_store_inaccessible`      | The provider exists, but reading the host store failed.   |
| `binding_absent`               | The provider was read successfully and returned no value. |
| `delivery_failed`              | Brokered delivery began and failed.                       |
| `ready`                        | Preflight completed successfully.                         |

The recurring Codex Seatbelt/macOS Keychain case is reported by `moltnet start`
before Node launches. The Node probe never opens the Keychain. Calling a denied
CLI lookup `binding_absent` or “secret missing” would claim a successful
Keychain lookup that never happened.
