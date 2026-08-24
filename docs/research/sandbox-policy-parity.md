# Sandbox policy parity: Docker Sandboxes and Gondolin

Status: completed research for issue #1972. This is retained evidence, not a
public API or a production Docker adapter.

## Conclusion

The research is no longer a blanket failure, but the backends are not at
parity.

- **Gondolin 0.12.0 is viable for the current production path.** MoltNet's
  hooks enforce exact protocol, host, and port for protected origins. Managed
  process-group execution confirms timeout and cancellation before returning.
- **Docker Sandbox's native custom-secret mechanism works.** Delivery,
  rotation, revocation, and restart rebinding all passed without copying the
  synthetic value into guest storage.
- **Docker still has two material failed-open behaviors.** A custom secret
  scoped to a host was delivered on an independently allowed adjacent port,
  and removing a sandbox did not stop detached work before its delayed side
  effect.
- Both runs completed cleanup, retained no secret value or machine path, and
  produced no evidence-validation violation.

This is enough to continue the portable policy and governed-execution design in
[#1980](https://github.com/getlarge/themoltnet/issues/1980). It is not enough
to call Docker and Gondolin interchangeable or to ship a production Docker
adapter.

## Reproduction

Both probes replay the same 31-scenario catalog with deterministic filesystem,
HTTP, credential, and delayed-side-effect oracles.

```bash
pnpm exec nx run @moltnet/tools:sandbox-policy-docker
pnpm exec nx run @moltnet/tools:sandbox-policy-gondolin
```

The targets are intentionally non-cacheable. They write atomically to
`tools/test-fixtures/sandbox-policy/observed/`, remove temporary output on
failure, and sanitize the complete run before promoting the value-free evidence
control.

The retained Darwin arm64 artifacts replay signed source revision
`efc46b952b65284351159f48028a006bfffe6277`.

| Backend        | Version | Enforced | Failed open | Unsupported | Violations | Cleanup  |
| -------------- | ------: | -------: | ----------: | ----------: | ---------: | -------- |
| Docker Sandbox | v0.39.0 |       20 |           3 |           8 |          0 | complete |
| Gondolin       |  0.12.0 |       25 |           0 |           6 |          0 | complete |

Counts are inventory, not scores. The state, oracle, and enforcement locus of
each control remain authoritative.

## What the corrected probes established

### Credentials

Docker's native `sbx secret set-custom` path is real and useful. The guest
receives a stand-in, while the control plane substitutes the synthetic value
for the configured host. Replacing the binding rotated the value, removing it
revoked delivery, and an explicit rebind restored it after restart.

The original negative result came from an invalid fixture topology:
`host.docker.internal` follows Docker's internal gateway path, where custom
secret substitution is not performed, and the placeholder had not been
provisioned in the guest. The corrected probe uses the normal proxy path and
seeds the placeholder during sandbox creation.

The remaining Docker failure is narrower but important: the binding is
host-scoped, not exact-origin scoped. After network access to the same host on
an adjacent port was independently allowed, the adjacent fixture received the
synthetic secret. MoltNet must not describe that as protocol/host/port
credential isolation.

Gondolin passed the exact-origin flow:

1. trusted host code resolves a logical binding;
2. the guest receives only a stable stand-in;
3. request and IP hooks enforce protocol, hostname, and port;
4. the host secret manager rotates or revokes the value;
5. resume requires an explicit trusted rebind.

The adjacent-origin test first proves that the uncredentialed network path is
reachable, then verifies that the same request carrying the protected stand-in
is stopped before any adjacent request or credential delivery. This avoids
mistaking network denial for credential isolation.

### Cancellation and timeout

Every Gondolin command now starts as a new session and process-group leader. It
stops before untrusted code runs, the host validates its `/proc` state, and a
nonce-bound first line transfers the trusted process-group ID. Cancellation
sends TERM, escalates to KILL, and confirms group absence. If confirmation is
impossible, the Pi caller retires the VM and surfaces a recovery failure.

Both the timeout and explicit-cancel scenarios confirmed process-group
termination and observed no delayed marker after the full six-second window.

Docker's native lifecycle oracle deliberately remains native: it launches
detached work, removes the scoped sandbox, and observes the mounted workspace.
In both timeout and cancellation scenarios, `sbx rm --force` returned
successfully but the detached process later wrote its marker. A future
production Docker adapter therefore needs an independently verified managed
execution layer; sandbox removal alone is not a cancellation guarantee.

The generic runner now waits for an aborted scenario to settle before starting
teardown or the next scenario. A timeout can no longer leave adapter work
racing in the background of the research harness.

### Network and filesystem

Basic containment worked on both backends:

- the workspace was writable and writes outside it were blocked;
- host credential files were absent;
- symlink traversal did not escape the workspace boundary;
- unlisted hosts were denied and an explicitly allowed destination worked;
- CPU and memory limits were independently observed;
- repeated close and final cleanup were idempotent.

Docker enforced its host-port network rule but did not prove general protocol
policy. Gondolin enforced protocol and adjacent-port denial through MoltNet's
hooks for the protected origin. The fixture records TCP connection counts as
well as HTTP requests, so protocol and redirect denials cannot pass merely
because a later TLS or HTTP step failed.

DNS rebinding remains unsupported on both. Gondolin's production `resumeVm`
path still has no read-only secondary-mount contract.

## Capability matrix

| Control                                      | Docker Sandbox v0.39.0 | Gondolin 0.12.0                             |
| -------------------------------------------- | ---------------------- | ------------------------------------------- |
| Workspace read/write and outside boundary    | enforced               | enforced                                    |
| Read-only secondary path                     | enforced               | unsupported                                 |
| Exact host-port network rule                 | enforced               | enforced for protected origin through hooks |
| General protocol fidelity                    | unsupported            | enforced for protected origin through hooks |
| Redirect revalidation                        | enforced               | enforced                                    |
| DNS rebinding                                | unsupported            | unsupported                                 |
| Required binding preflight                   | unsupported            | enforced                                    |
| Allowed-origin secret delivery               | enforced               | enforced                                    |
| Adjacent-origin secret isolation             | **failed open**        | enforced                                    |
| Rotation, revocation, explicit resume rebind | enforced               | enforced                                    |
| Timeout and cancellation containment         | **failed open**        | enforced                                    |
| Broker unavailable preflight                 | unsupported            | enforced                                    |
| Partial launch after resource allocation     | unsupported            | unsupported                                 |
| Repeated close and cleanup                   | enforced               | enforced                                    |
| CPU and memory limits                        | enforced               | enforced                                    |
| Host MCP, signing, model traffic             | outside containment    | outside containment                         |

Configuration-only topology and requested/effective-policy rows are retained as
`declared` or `applied` with state `unsupported`; they are not promoted to
enforced without an independent oracle.

## Implications for the public model

The research supports a portable containment vocabulary, not a lowest-common
denominator that hides backend failures. A public policy can describe:

- workspace access and denial outside the workspace;
- destination intent with protocol, host, and port;
- logical credential requirements bound to exact destinations, never values;
- CPU and memory limits;
- lifecycle requirements and explicit supported, degraded, or unsupported
  adapter decisions.

Backend mechanics stay in trusted adapters: Docker sandbox names and custom
secret handles, Gondolin checkpoints and hooks, VFS paths, proxy routing,
machine-local credential providers, and mandatory platform egress.

Requested intent, adapter resolution, applied state, and verified evidence stay
separate. If an adapter cannot implement a required exact-origin or lifecycle
control, resolution fails; it does not silently widen the policy.

The persistence and task-independent execution convention is owned by
[#1980](https://github.com/getlarge/themoltnet/issues/1980) and summarized in
[the storage follow-up](./sandbox-policy-storage-follow-up.md).

## Decision and next work

1. Use the Gondolin implementation and managed supervisor as the current
   production reference.
2. Keep the Docker adapter research-only until exact credential scoping and
   cancellation have a verified compensating implementation.
3. Define `SandboxPolicy`, the single resolved execution snapshot, and the
   task-independent governed execution in #1980.
4. Land persistence only as a vertical slice that resolves and pins a complete
   execution; do not add an unused sandbox-policy table first.
5. Keep the 31-scenario suite as adapter conformance evidence and replay it for
   every supported backend/version.

## Limitations

- The retained runs cover one Darwin arm64 host, Docker Sandbox v0.39.0, and
  Gondolin v0.12.0.
- DNS rebinding is not measured.
- General Gondolin destination policy is still hostname-granular unless
  MoltNet compiles the destination through exact request/IP hooks.
- No paid model call is part of the suite. Deterministic containment oracles
  provide stronger and reproducible evidence.
- The local DNS aliases route only synthetic values to host fixtures; retained
  artifacts contain match results, not credential material.
