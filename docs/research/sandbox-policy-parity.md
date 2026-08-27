# Sandbox policy parity: Docker Sandboxes and Gondolin

Status: completed research for issues #1972 and #2004, with Docker follow-up
results for #2005 and #2006. This is retained evidence, not a public API or a
production Docker adapter.

## Conclusion

The backends are not at native-feature parity, and neither retained run proves
every row in the complete catalog. Both adapters now conform for policies that
require the independently verified controls they implement.

- **Gondolin 0.12.0 proves exact-origin credential delivery and lifecycle
  containment.** A test-only, fail-closed transport maps exact RFC 5737
  TEST-NET origins to literal loopback fixtures. Exact allow, wrong
  host/port/protocol, redirect revalidation, credential isolation, rotation,
  revocation, restart rebinding, timeout, and cancellation all passed.
- **Docker Sandbox v0.39.0 is eligible through two trusted adapter
  compensators.** Its native custom-secret binding remains host-scoped, so an
  adapter-owned, fail-closed upstream proxy terminates Docker's HTTP tunnels,
  checks the exact protocol/hostname/port, and removes credentials everywhere
  except the protected origin. Its supported stop/remove flow remains
  insufficient for prompt containment, so cancellation uses the dedicated
  daemon's private Engine socket to identify and kill the exact sandbox
  container before cleanup. Exact-origin delivery and isolation, rotation,
  revocation, restart rebinding, timeout, and cancellation all passed.
- Both runs completed cleanup, retained no secret value or machine path, and
  produced no evidence-validation violation.

This supports the portable policy and governed-execution design in
[#1980](https://github.com/getlarge/themoltnet/issues/1980): resolve a policy
against adapter capabilities, then choose the first conforming adapter. It does
not make native Docker and Gondolin mechanisms interchangeable. The Docker
compensators are version-coupled and must remain trusted host implementation
details.

## Reproduction

Both probes replay the same 31-scenario catalog with deterministic filesystem,
HTTP, credential, and delayed-side-effect oracles.

The retained replay requires a Darwin arm64 host, Docker Sandboxes with `sbx`
v0.39.0 on `PATH`, and the workspace-pinned Gondolin 0.12.0 dependency with its
snapshot available. Docker requires a dedicated, authenticated application
namespace whose policy has been initialized. Gondolin requests use exact
TEST-NET origins whose trusted-host transport is pinned to loopback. Docker
uses reserved `.test` hostnames because v0.39.0 records an allowed IP literal
as a domain resource but evaluates the request as a CIDR resource. Neither
fixture depends on public wildcard DNS.

```bash
MOLTNET_DOCKER_SANDBOX_APP_NAME=mnet-p200506 \
  pnpm exec nx run @moltnet/tools:sandbox-policy-docker
pnpm exec nx run @moltnet/tools:sandbox-policy-gondolin
```

The targets are intentionally non-cacheable. They write atomically to
`tools/test-fixtures/sandbox-policy/observed/`, remove temporary output on
failure, and sanitize the complete run before promoting the value-free evidence
control.

The retained Docker artifact replays signed source revision
`f66e015fcd5fd1723eaf00428b82483cee99bd45`. The Gondolin artifact replays
the signed implementation revision `b143846ec11f8817df4395bdf60a214b43a2f149`.

| Backend        | Version | Enforced | Failed open | Unsupported | Violations | Cleanup  |
| -------------- | ------: | -------: | ----------: | ----------: | ---------: | -------- |
| Docker Sandbox | v0.39.0 |       24 |           0 |           7 |          0 | complete |
| Gondolin       |  0.12.0 |       22 |           0 |           9 |          0 | complete |

Counts are inventory, not scores. The state, oracle, and enforcement locus of
each control remain authoritative.

## What the corrected probes established

### Credentials

Docker's native [`sbx secret set-custom`
path](https://docs.docker.com/ai/sandboxes/configuration/credentials/) is real
and useful. The guest
receives a stand-in, while the control plane substitutes the synthetic value
for the configured host. Replacing the binding rotated the value, removing it
revoked delivery, and an explicit rebind restored it after restart.

The original negative result came from an invalid fixture topology:
`host.docker.internal` follows Docker's internal gateway path, where custom
secret substitution is not performed, and the placeholder had not been
provisioned in the guest. The corrected probe uses the normal proxy path and
seeds the placeholder during sandbox creation.

The native Docker limitation is narrower but important: the binding is
host-scoped, not exact-origin scoped. After network access to the same host on
an adjacent port was independently allowed, the adjacent fixture received the
synthetic secret. Exact host-port network rules cannot narrow the binding or
distinguish protocols; a portable policy may legitimately allow another port
without granting it the credential.

The #2005 follow-up found no supported native credential surface that closes
this gap. The compensating implementation uses Docker's experimental
[host-side upstream-proxy
setting](https://docs.docker.com/ai/sandboxes/configuration/upstream-proxy/).
Docker v0.39.0 sends `CONNECT` to that proxy for both HTTP and HTTPS. The
trusted proxy accepts only deliberately mapped authorities,
peeks at the tunneled protocol, terminates plain HTTP, revalidates the inner
origin, and forwards to literal loopback fixtures. It preserves
`Authorization` only for the canonical protected origin and removes it for
every other mapped route; unmapped authorities, inner origins, and TLS fail
closed before fixture delivery.

The negative proof maps wrong host, wrong port, redirect, and independently
network-allowed adjacent origins so a policy error could reach a fixture.
Wrong protocol and direct literal-loopback attempts are denied before
forwarding. The replay observed one protected delivery, four credential-free
negative fixture requests, one protected redirect match, six proxy decisions,
and zero negative credential matches. Rotation, revocation, explicit restart
rebinding, and value-free persisted evidence also passed.

The proxy is not guest-configurable and is installed before sandbox creation in
a dedicated Docker Sandbox daemon namespace. The adapter rejects pre-existing
`proxy.sandbox` or `no_proxy.sandbox` overrides, restores the setting during
cleanup, and deliberately maps the requested `localhost` and Docker's effective
`host.docker.internal` network-fixture names without preserving credentials.
Literal `127.0.0.1` remains unmapped, preserving the direct-loopback bypass
control.

Gondolin established the corresponding flow through a narrow research-only
route seam. `VmConfig.testOnlyHttpRoutes` accepts only exact RFC 5737 source
origins and literal `http://127.0.0.1:<port>` targets; every unmapped origin
fails closed. Negative host, port, protocol, and redirect origins are mapped
deliberately, so a policy failure could have reached the fixture and remains
falsifiable.

This is intentionally not a general custom-fetch capability. Gondolin 0.12's
default fetch pins the actual connection to the IP accepted by its policy;
supplying a custom fetch performs the preliminary IP check but disables that
connect-time dispatcher. The static fixture routes avoid DNS entirely, while
ordinary production resumes leave Gondolin's default fetch untouched.

The protected origin received the substituted credential. An adjacent origin
was independently proven network-reachable without credentials; attempting to
send the protected placeholder there was rejected before fixture delivery.
Rotation, revocation, and explicit rebinding after checkpoint resume also
passed. The proof does not credit `hostOrigins`, public wildcard DNS, or native
raw-TCP host mapping because each bypasses or weakens the HTTP-hook boundary
being measured.

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

The first Docker follow-up exercised the strongest composition available
through its supported CLI: launch detached work, call `sbx stop`, independently
parse `sbx ls --json` for the exact `stopped` state, call `sbx rm --force`, parse
the inventory again for absence, and observe the mounted workspace through the
full delay window. In both timeout and cancellation scenarios every control
plane operation succeeded, yet the detached process later wrote its marker.
Neither `stopped` nor backend absence is a containment receipt.

The #2006 compensator uses the private Engine socket owned by the adapter's
dedicated Docker Sandbox daemon. Before sending `KILL`, it resolves exactly one
container and verifies the normalized sandbox name, Docker Sandbox identity
label, sandbox-name label, and exact workspace path. It inspects the immutable
container ID, kills that ID, and polls the same ID until it is not running. A
missing or ambiguous identity, mismatched workspace, failed kill, or unconfirmed
retirement poisons the adapter and prevents later work from receiving
containment credit. Supported `sbx stop` and `sbx rm --force` remain cleanup and
recovery operations, not the oracle.

Both retained lifecycle controls launched delayed work in a separate `setsid`
session, immediately retired the identity-verified Engine container, and
observed the mounted workspace for the full delay window. The Engine reported a
`KILL` exit and neither timeout nor explicit cancellation produced a marker.
The adapter therefore conforms for these controls on v0.39.0, although the
private socket is an undocumented, version-coupled dependency that must be
replayed before supporting another Docker Sandbox version.

The replay also independently promotes two narrower lifecycle controls. A
deliberately failed launch after sandbox allocation was stopped, removed, and
proven absent. Removing a disposable sandbox twice was idempotent at the adapter
boundary and left it absent after both calls. These results independently
establish cleanup behavior without being used as the cancellation oracle.

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

Repeated close remains unsupported in the Gondolin retained run. Docker now
uses a backend-native disposable sandbox and independently observes absence
after both removal calls; it no longer infers idempotence from the cleanup
manifest.

Docker enforced its host-port network rule but did not prove general protocol
policy. Gondolin's pinned TEST-NET transport proved its positive path before
promoting wrong-host, wrong-port, wrong-protocol, and redirect negative
controls. Canonical brokered-origin decisions remain value-free diagnostics in
the controlled fixture run. The hostname-policy diagnostic records inputs
passed to Gondolin, not independently resolved state, so the
requested/effective row remains unsupported. Guest `127.0.0.1` isolation also
does not prove host-hook denial, so the internal-target row is no longer
promoted.

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
| Exact host-port network rule                 | enforced                | enforced                |
| Protocol mismatch denial                     | unsupported             | enforced                |
| Redirect revalidation                        | enforced                | enforced                |
| DNS rebinding                                | unsupported             | unsupported             |
| Required binding preflight                   | unsupported             | enforced                |
| Allowed-origin secret delivery               | enforced                | enforced                |
| Adjacent-origin secret isolation             | enforced (compensated)  | enforced                |
| Rotation, revocation, explicit resume rebind | enforced                | enforced                |
| Timeout and cancellation containment         | enforced (compensated)  | enforced                |
| Broker unavailable preflight                 | unsupported             | unsupported             |
| Partial launch after resource allocation     | enforced                | unsupported             |
| Repeated close                               | enforced                | unsupported             |
| Final cleanup                                | complete                | complete                |
| CPU and memory limits                        | enforced (guest report) | enforced (guest report) |
| Host MCP, signing, model traffic             | outside containment     | outside containment     |

Configuration-only topology remains unsupported. Gondolin's
requested/effective-policy row is promoted because the runtime emits the
complete effective hostname policy and the harness independently verifies that
the intended TEST-NET hosts are present while denied controls are absent.

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

Backend mechanics stay in trusted adapters: Docker application namespaces,
private Engine identities, sandbox names, custom-secret handles, and upstream
proxy routing; Gondolin checkpoints and hooks; VFS paths; machine-local
credential providers; and mandatory platform egress.

Requested intent, adapter resolution, applied state, and verified evidence stay
separate. If an adapter cannot implement a required exact-origin or lifecycle
control, resolution fails; it does not silently widen the policy.

The persistence and task-independent execution convention is owned by
[#1980](https://github.com/getlarge/themoltnet/issues/1980) and summarized in
[the storage follow-up](./sandbox-policy-storage-follow-up.md).

## Decision and next work

1. Treat exact-origin credentials and host-authoritative retirement as required
   guarantees, independent of whether a backend implements them natively or a
   trusted adapter supplies a verified compensator.
2. Make Docker Sandbox v0.39.0 eligible for policies whose required controls are
   all `enforced` in the retained artifact. Pin the version and require the
   dedicated-daemon proxy and private-Engine compensators; do not fall back to
   the falsified native host binding or CLI stop/remove receipt.
3. Define `SandboxPolicy`, the single resolved execution snapshot, and the
   task-independent governed execution in #1980.
4. Land persistence only as a vertical slice that resolves and pins a complete
   execution; do not add an unused sandbox-policy table first.
5. Keep the 31-scenario suite as adapter conformance evidence and replay it for
   every supported backend/version.

## Limitations

- The retained runs cover one Darwin arm64 host, Docker Sandbox v0.39.0, and
  Gondolin v0.12.0.
- Docker's upstream-proxy setting is experimental, and the Engine socket used
  for prompt retirement is private. Both compensators are pinned to the tested
  Docker Sandbox version and require a fresh replay before version promotion.
- Docker v0.39.0's IP-literal policy classification prevented the Docker probe
  from using RFC 5737 destinations. Reserved `.test` origins are routed only by
  the trusted proxy to literal loopback fixtures.
- DNS rebinding is not measured.
- The trusted Gondolin transport is a host integration primitive, not a runtime
  profile field or guest capability. Its route map must remain exact and
  fail-closed.
- Gondolin deny-all egress, DNS rebinding, and read-only secondary mounts remain
  unsupported by this retained run.
- No paid model call is part of the suite. Deterministic containment oracles
  provide stronger and reproducible evidence.
- Retained artifacts contain match results, not credential material.
