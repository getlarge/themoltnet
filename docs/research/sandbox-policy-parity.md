# Sandbox policy parity: Docker Sandboxes and Gondolin

Status: research evidence for issue #1972. This is not a public API or a
production Docker adapter.

## Decision

The remediated research checkpoint passes: both retained current runs have no
failed-open controls. This approves the portable vocabulary for a dedicated
design follow-up. It does not create a public API, authorize persistence, or
claim that a production Docker adapter exists.

The failures in the first run were useful adapter findings, not reasons to
replace backend facilities:

- Docker's native custom-secret proxy works. The original fixture used
  `host.docker.internal`, an internal gateway path where credential injection
  is not performed, and created the binding after sandbox creation without
  provisioning the placeholder environment value. The corrected probe seeds
  the stand-in at creation and sends requests through the normal proxy path to
  a hostname that resolves back to the local fixture.
- Detached Docker commands inherited the launcher's output pipes, so the host
  waited for the payload despite `--detach`. The launcher now closes all three
  streams, records a process-group ID, and exits before termination is tested.
- Gondolin 0.12.0 still has hostname-granular `allowedHosts`, but its request
  and IP hooks expose protocol and port. MoltNet now composes exact
  protocol/host/port checks for brokered origins through those hooks.
- Cancellation and timeout now use a managed process group. They send TERM,
  escalate to KILL, and confirm group absence. Gondolin closes the VM as the
  stronger fallback if its control exec cannot be started.

## Reproduction

The probes use the same 31-scenario catalog and deterministic shell/HTTP
fixtures. They use only random synthetic sentinels.

```bash
pnpm exec nx run @moltnet/tools:sandbox-policy-docker
pnpm exec nx run @moltnet/tools:sandbox-policy-gondolin
```

Both Nx targets are intentionally non-cacheable. Each run writes a sanitized
artifact under `tools/test-fixtures/sandbox-policy/observed/`. Docker creates
only uniquely named sandboxes and sandbox-scoped rules/bindings; it never uses
global reset, prune, or `--all` operations. Gondolin calls the production
`ensureSnapshot` and `resumeVm` path.

Relevant upstream contracts are Docker's
[custom-secret command](https://docs.docker.com/reference/cli/sbx/secret/set-custom/)
and [credential proxy model](https://docs.docker.com/ai/sandboxes/security/credentials/),
plus the [Gondolin 0.12.0 release](https://github.com/earendil-works/gondolin/releases/tag/v0.12.0)
and its [HTTP hook API](https://github.com/earendil-works/gondolin/blob/v0.12.0/host/src/http/hooks.ts).

Observed hosts:

| Backend        | Exact adapter version   | Host         | Result counts                             | Cleanup  |
| -------------- | ----------------------- | ------------ | ----------------------------------------- | -------- |
| Docker Sandbox | v0.39.0                 | Darwin arm64 | 29 enforced, 0 failed-open, 2 unsupported | complete |
| Gondolin       | 0.12.0 workspace source | Darwin arm64 | 29 enforced, 0 failed-open, 2 unsupported | complete |

Counts are inventory only, not a coverage score. Every individual state and
oracle remains authoritative.

## Capability and degradation matrix

| Control                                | Docker Sandbox          | Gondolin                    | Enforcement locus and consequence                                                    |
| -------------------------------------- | ----------------------- | --------------------------- | ------------------------------------------------------------------------------------ |
| Workspace read/write                   | enforced                | enforced                    | Docker bind mount; Gondolin host VFS mount                                           |
| Outside-workspace and symlink writes   | enforced                | enforced                    | Container mount boundary; microVM + VFS boundary                                     |
| Read-only secondary path               | enforced                | unsupported                 | Docker read-only mount; no equivalent `resumeVm` secondary-mount contract            |
| Host credential path absent            | enforced                | enforced                    | Unmounted host path; `host-authenticated` guest mode                                 |
| Default-deny / unlisted hostname       | enforced                | enforced                    | Docker network proxy; Gondolin host HTTP hooks                                       |
| Allowed destination                    | enforced                | enforced                    | Docker translates local policy to host gateway; Gondolin allows the fixture hostname |
| Adjacent port at network layer         | enforced                | enforced                    | Docker host-port rule; MoltNet exact-origin hooks protect Gondolin brokered hosts    |
| Protocol fidelity                      | unsupported             | enforced for broker binding | Docker fixture did not prove protocol policy; Gondolin exact-origin hook + binding   |
| Redirect to unlisted origin            | enforced                | enforced                    | Backend network proxies/hooks                                                        |
| DNS rebinding                          | unsupported             | unsupported                 | No controlled rebinding oracle in this run                                           |
| Required credential binding preflight  | enforced                | enforced                    | Research adapter preflight; Gondolin `resumeVm` preflight                            |
| Allowed-origin credential delivery     | enforced                | enforced                    | Docker native custom-secret proxy; Gondolin brokered-secret HTTP hooks               |
| Adjacent-origin credential delivery    | enforced (zero matches) | enforced (zero matches)     | Exact network/proxy composition; Gondolin exact-origin hook                          |
| Rotation                               | enforced                | enforced                    | Docker scoped custom-secret update; Gondolin host secret manager                     |
| Revocation                             | enforced                | enforced                    | Docker scoped binding removal; Gondolin host secret manager                          |
| Resume/rebind                          | enforced                | enforced                    | Explicit backend-local rebinding after restart/resume                                |
| Timeout/cancel delayed child           | enforced                | enforced                    | Managed process group with delayed-marker and group-absence oracles                  |
| Missing broker / partial launch        | enforced                | enforced                    | Adapter or `resumeVm` preflight before guest work                                    |
| Repeated close and cleanup             | enforced                | enforced                    | Neutral cleanup manifest calls backend close twice                                   |
| Checkpoint storage surfaces            | enforced                | enforced                    | Bind mount/container lifecycle; VFS workspace/microVM volatile state                 |
| CPU and memory request                 | enforced                | enforced                    | Docker cgroup; Gondolin QEMU configuration                                           |
| Host MCP, exec, signing, model traffic | outside containment     | outside containment         | Host/orchestrator capability, never attributed to guest sandbox                      |

`failed-open` means a verified independent oracle contradicted the requested
control. `unsupported` means the adapter made no enforcement claim. A backend
success response or declaration alone is never counted as enforced.

## Requested versus effective policy

The portable request names a destination without prescribing backend routing.

- Docker request: the local fixture origin. Ordinary network controls use the
  `host.docker.internal` guest destination and a sandbox-local
  `localhost:<port>` rule. Credential controls use `127.0.0.1.nip.io`, which
  resolves to the same host fixture while traversing the normal credential
  proxy, plus an exact sandbox-local host-port rule.
- Gondolin request: the same fixture origin. Effective network binding:
  `127-0-0-1.sslip.io` in `allowedInternalHosts`, which is hostname-granular.
  MoltNet's composed request/IP hooks enforce protocol, hostname, and port for
  that brokered origin.

Mandatory platform egress was not observed in either retained run. If a future
backend adds destinations, the complete effective list must appear in evidence;
it cannot be hidden behind a successful request.

## Proposed minimal `SandboxPolicy` v1 vocabulary

This is an internal proposal for the next supervisor review, not a schema:

```ts
interface SandboxPolicyV1Proposal {
  workspace: {
    access: 'read-write';
    denyOutsideWorkspace: true;
  };
  network: {
    default: 'deny';
    allowedDestinations: Array<{
      host: string;
      ports?: number[];
      internal?: boolean;
    }>;
  };
  credentials?: {
    requiredBindings: Array<{
      id: string;
      origins: Array<{
        protocol: 'http' | 'https';
        host: string;
        ports: number[];
      }>;
    }>;
  };
  lifecycle: {
    terminateProcessGroupOnAbort: true;
  };
  resources?: {
    cpus?: number;
    memory?: string;
  };
}
```

This is the smallest useful intersection supported by the remediated evidence.
Binding IDs are value-free references resolved by trusted host configuration;
secret values never enter this document. The proposal omits:

- read-only paths, because the production Gondolin path has no equivalent
  secondary-mount contract;
- protocol on general network destinations, because Docker protocol fidelity
  was not proved; protocol remains mandatory on credential origins;
- checkpoint semantics, VFS shadows, hostname rewriting, agent templates,
  custom-secret handles, and local keyring coordinates.

Those omissions are safety properties: callers must not infer that an absent
field is enforced by a backend.

## Trusted adapter-only bindings

The following remain local, value-free references or trusted host inputs:

- Docker sandbox name/template, host-gateway rewrite, local policy rule IDs,
  custom-secret placeholder and resolver lifecycle;
- Gondolin checkpoint path, `allowedInternalHosts` rewrite, VFS shadow mode,
  resume commands, guest placeholder, and secret-manager handle;
- synthetic or real secret values and secret-provider coordinates;
- provider authentication, agent credentials, signing keys, MCP grants, host
  exec policy, and model traffic;
- machine paths and runtime resource identifiers.

## Evidence limitations

- The current retained artifacts describe Docker v0.39.0 and Gondolin 0.12.0
  workspace source on one Darwin arm64 host. They do not generalize across
  versions or operating systems without replay.
- DNS rebinding and a Gondolin read-only secondary mount remain unsupported.
- The probes make no paid Codex or Claude call. Deterministic fixtures are the
  authoritative containment evidence; provider calls would add cost and model
  variance without strengthening these oracles.
- `127.0.0.1.nip.io` is used only to make the local Docker fixture traverse the
  ordinary proxy path. No credential value is sent to that DNS service, and
  retained evidence contains only value-free matches.

## Supervisor checkpoint

Decision: **APPROVE the vocabulary for a dedicated design follow-up; no schema
or persistence is authorized by issue #1972**.

Conditions before production schema or persistence:

1. implement and review a production Docker adapter; the current Docker adapter
   remains a research harness;
2. define ownership, authorization, immutable revision, and claim-time pinning
   semantics from the storage follow-up;
3. replay the proposal on every adapter version selected for production;
4. add a controlled DNS-rebinding oracle and decide whether the unsupported
   read-only secondary mount is outside v1 or a release blocker;
5. a supervisor signs an explicit persistence approval before schema or public
   SDK work starts.
