# Sandbox policy parity: Docker Sandboxes and Gondolin

Status: completed research for issue #1972. This is retained evidence, not a
public API or a production Docker adapter.

## Conclusion

The backends are not at parity, and neither retained run satisfies the complete
required policy.

- **Gondolin 0.12.0 fixes the lifecycle failure, but exact-destination and
  credential delivery are not proven.** Timeout and cancellation retire the
  whole microVM through Gondolin's host API before returning. However, a safe
  literal-loopback fixture stays inside the guest and never reaches the host
  HTTP hooks. Gondolin's native host mapping enables raw TCP, which bypasses
  those same hooks. The positive network and credential controls therefore
  fail open, and dependent negatives remain unsupported.
- **Docker Sandbox's native custom-secret mechanism works.** Delivery,
  rotation, revocation, and restart rebinding all passed without copying the
  synthetic value into guest storage.
- **Docker still has two material failed-open behaviors across three
  scenarios.** A custom secret scoped to a host was delivered on an
  independently allowed adjacent port. Separately, removing a sandbox did not
  stop detached work after either timeout or cancellation.
- Both runs completed cleanup, retained no secret value or machine path, and
  produced no evidence-validation violation.

This is enough to continue the portable policy and governed-execution design in
[#1980](https://github.com/getlarge/themoltnet/issues/1980). It is not enough
to call Docker and Gondolin interchangeable or to ship a production Docker
adapter.

## Reproduction

Both probes replay the same 31-scenario catalog with deterministic filesystem,
HTTP, credential, and delayed-side-effect oracles.

The retained replay requires a Darwin arm64 host, Docker Sandboxes with `sbx`
v0.39.0 on `PATH`, and the workspace-pinned Gondolin 0.12.0 dependency with its
snapshot available. The final fixtures use literal loopback and do not depend
on public wildcard DNS.

```bash
pnpm exec nx run @moltnet/tools:sandbox-policy-docker
pnpm exec nx run @moltnet/tools:sandbox-policy-gondolin
```

The targets are intentionally non-cacheable. They write atomically to
`tools/test-fixtures/sandbox-policy/observed/`, remove temporary output on
failure, and sanitize the complete run before promoting the value-free evidence
control.

The retained Darwin arm64 artifacts replay signed source revision
`6c8d7e6bb07399558986ee1b6eba271c9aab3a59`.

| Backend        | Version | Enforced | Failed open | Unsupported | Violations | Cleanup  |
| -------------- | ------: | -------: | ----------: | ----------: | ---------: | -------- |
| Docker Sandbox | v0.39.0 |       19 |           3 |           9 |          0 | complete |
| Gondolin       |  0.12.0 |       12 |           2 |          17 |          0 | complete |

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

Gondolin did not establish the corresponding flow. The safe fixture binds only
to host loopback, but literal `127.0.0.1` in the guest is guest-local and
produced zero host requests. Native TCP host mapping is not a substitute: it
sets raw-TCP access and bypasses the HTTP hooks that perform exact-origin
checks and secret substitution. Because the allowed-origin positive baseline
failed, rotation, revocation, resume, and adjacent-origin isolation are not
claimed. This avoids turning network unreachability into credential proof.

### Cancellation and timeout

Successful Gondolin commands may reuse their microVM. An interrupted command
does not try to prove containment using guest process IDs, `/proc`, `setsid`, or
`kill`: those are all under the guest's control. Instead, timeout or explicit
cancellation immediately calls Gondolin's host-side `vm.close()` and returns
only after that retirement succeeds or fails. A successful retirement
invalidates the runtime's VM reference; a failed retirement poisons it and
surfaces an explicit recovery failure.

Both lifecycle probes launched delayed work in a separate `setsid` session,
then triggered timeout or explicit cancellation. Host-side VM retirement
completed and no delayed marker appeared during the full six-second observation
window. This directly covers the escape that invalidated the earlier
process-group result.

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
- Docker denied unlisted hosts and allowed its explicit destination;
- configured CPU and memory ceilings were reported from inside each guest;
- final cleanup completed without residue.

Repeated close remains explicitly unsupported in both retained runs. The
runner owns final teardown and no longer manufactures a passing oracle by
calling `close()` a second time; adapters need a backend-native, independently
observable repeated-close probe before that control can be promoted.

Docker enforced its host-port network rule but did not prove general protocol
policy. Gondolin's safe positive fixture did not reach MoltNet's hooks, so the
suite cannot claim exact allow, protocol, adjacent-port, or redirect behavior.
Those dependent controls are unsupported rather than passing from zero
traffic. A future fixture needs pinned host resolution that still traverses the
HTTP hooks; public wildcard DNS and broad trusted-host rerouting are not
acceptable substitutes.

DNS rebinding remains unsupported on both. Gondolin's production `resumeVm`
path still has no read-only secondary-mount contract.

The Docker `network.deny-all` catalog row probes an unlisted destination under
the active sandbox policy; it does not launch a separate no-egress sandbox.
Gondolin records that row as unsupported. The retained suite therefore does
not establish a backend-wide no-egress mode.

## Capability matrix

| Control                                      | Docker Sandbox v0.39.0  | Gondolin 0.12.0         |
| -------------------------------------------- | ----------------------- | ----------------------- |
| Workspace read/write and outside boundary    | enforced                | enforced                |
| Read-only secondary path                     | enforced                | unsupported             |
| Exact host-port network rule                 | enforced                | **failed open**         |
| General protocol fidelity                    | unsupported             | unsupported             |
| Redirect revalidation                        | enforced                | unsupported             |
| DNS rebinding                                | unsupported             | unsupported             |
| Required binding preflight                   | unsupported             | enforced                |
| Allowed-origin secret delivery               | enforced                | **failed open**         |
| Adjacent-origin secret isolation             | **failed open**         | unsupported             |
| Rotation, revocation, explicit resume rebind | enforced                | unsupported             |
| Timeout and cancellation containment         | **failed open**         | enforced                |
| Broker unavailable preflight                 | unsupported             | unsupported             |
| Partial launch after resource allocation     | unsupported             | unsupported             |
| Repeated close                               | unsupported             | unsupported             |
| Final cleanup                                | complete                | complete                |
| CPU and memory limits                        | enforced (guest report) | enforced (guest report) |
| Host MCP, signing, model traffic             | outside containment     | outside containment     |

Configuration-only topology and requested/effective-policy rows are retained as
`declared` or `applied` with state `unsupported`; they are not promoted to
enforced without an independent oracle.

This matrix groups related scenarios for readability; it is not a one-to-one
rendering of the 31 catalog rows. The retained JSON controls, keyed by
`scenarioId`, are the canonical mapping.

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

1. Use Gondolin's host-authoritative VM retirement as the lifecycle reference,
   but do not claim exact-origin or credential parity until a safe fixture and
   routing primitive traverse its HTTP hooks.
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
- Gondolin 0.12.0 exposes no demonstrated pinned host-resolution mechanism that
  both reaches a host fixture and preserves HTTP-hook enforcement. Its native
  TCP host mapping bypasses those hooks.
- No paid model call is part of the suite. Deterministic containment oracles
  provide stronger and reproducible evidence.
- Retained artifacts contain match results, not credential material.
