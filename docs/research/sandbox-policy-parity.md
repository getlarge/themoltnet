# Sandbox policy parity: Docker Sandboxes and Gondolin

Status: research evidence for issue #1972. This is not a public API or a
production Docker adapter.

## Decision

Do not normalize sandbox policy into storage yet. The common vocabulary below
is useful, but the supervisor checkpoint is **rejected pending remediation**:

- Docker Sandbox v0.39.0 did not deliver the synthetic credential through the
  exercised custom-secret binding.
- Docker Sandbox scoped removal and Gondolin raw exec abort both allowed an
  acknowledged delayed child to write after termination was requested.
- Gondolin runtime networking is hostname-granular, so the adjacent port was
  reachable even though credential substitution remained origin-bound.

The evidence therefore supports a narrow vocabulary, not a production
enforcement promise. A later supervisor must approve a revised proposal after
the failed-open controls are fixed or explicitly placed behind a stronger
enforcement locus.

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

Observed hosts:

| Backend        | Exact adapter version  | Host         | Result counts                             | Cleanup  |
| -------------- | ---------------------- | ------------ | ----------------------------------------- | -------- |
| Docker Sandbox | v0.39.0                | Darwin arm64 | 23 enforced, 6 failed-open, 2 unsupported | complete |
| Gondolin       | 0.9.1 workspace source | Darwin arm64 | 26 enforced, 3 failed-open, 2 unsupported | complete |

Counts are inventory only, not a coverage score. Every individual state and
oracle remains authoritative.

## Capability and degradation matrix

| Control                                | Docker Sandbox          | Gondolin                    | Enforcement locus and consequence                                                          |
| -------------------------------------- | ----------------------- | --------------------------- | ------------------------------------------------------------------------------------------ |
| Workspace read/write                   | enforced                | enforced                    | Docker bind mount; Gondolin host VFS mount                                                 |
| Outside-workspace and symlink writes   | enforced                | enforced                    | Container mount boundary; microVM + VFS boundary                                           |
| Read-only secondary path               | enforced                | unsupported                 | Docker read-only mount; no equivalent `resumeVm` secondary-mount contract                  |
| Host credential path absent            | enforced                | enforced                    | Unmounted host path; `host-authenticated` guest mode                                       |
| Default-deny / unlisted hostname       | enforced                | enforced                    | Docker network proxy; Gondolin host HTTP hooks                                             |
| Allowed destination                    | enforced                | enforced                    | Docker translates local policy to host gateway; Gondolin allows the fixture hostname       |
| Adjacent port at network layer         | enforced                | **failed-open**             | Docker host-port rule; Gondolin runtime network policy is hostname-granular                |
| Protocol fidelity                      | unsupported             | enforced for broker binding | Docker fixture did not prove protocol policy; Gondolin secret binding attests HTTP + port  |
| Redirect to unlisted origin            | enforced                | enforced                    | Backend network proxies/hooks                                                              |
| DNS rebinding                          | unsupported             | unsupported                 | No controlled rebinding oracle in this run                                                 |
| Required credential binding preflight  | enforced                | enforced                    | Research adapter preflight; Gondolin `resumeVm` preflight                                  |
| Allowed-origin credential delivery     | **failed-open**         | enforced                    | Docker custom-secret proxy; Gondolin brokered-secret HTTP hooks                            |
| Adjacent-origin credential delivery    | enforced (zero matches) | enforced (zero matches)     | Docker network + proxy; Gondolin origin-bound broker despite hostname network access       |
| Rotation                               | **failed-open**         | enforced                    | Docker scoped custom secret; Gondolin host secret manager                                  |
| Revocation                             | **failed-open**         | enforced                    | Docker lacks prior successful delivery proof; Gondolin verifies delivery before revocation |
| Resume/rebind                          | **failed-open**         | enforced                    | Docker scoped custom secret after restart; Gondolin explicit `resumeVm` rebinding          |
| Timeout/cancel delayed child           | **failed-open**         | **failed-open**             | Docker scoped sandbox removal; Gondolin host exec-session abort                            |
| Missing broker / partial launch        | enforced                | enforced                    | Adapter or `resumeVm` preflight before guest work                                          |
| Repeated close and cleanup             | enforced                | enforced                    | Neutral cleanup manifest calls backend close twice                                         |
| Checkpoint storage surfaces            | enforced                | enforced                    | Bind mount/container lifecycle; VFS workspace/microVM volatile state                       |
| CPU and memory request                 | enforced                | enforced                    | Docker cgroup; Gondolin QEMU configuration                                                 |
| Host MCP, exec, signing, model traffic | outside containment     | outside containment         | Host/orchestrator capability, never attributed to guest sandbox                            |

`failed-open` means a verified independent oracle contradicted the requested
control. `unsupported` means the adapter made no enforcement claim. A backend
success response or declaration alone is never counted as enforced.

## Requested versus effective policy

The portable request names a destination without prescribing backend routing.

- Docker request: the local fixture origin. Effective binding: a
  `host.docker.internal` guest destination plus a sandbox-local
  `localhost:<port>` network rule. Credential lifecycle remains backend-local.
- Gondolin request: the same fixture origin. Effective network binding:
  `127-0-0-1.sslip.io` in `allowedInternalHosts`, which is hostname-granular.
  Its separate credential binding attests protocol, hostname, and port.

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
    allowedHosts: string[];
    allowedInternalHosts?: string[];
  };
  resources?: {
    cpus?: number;
    memory?: string;
  };
}
```

This is the smallest useful intersection verified by both adapters. It omits:

- read-only paths, because the production Gondolin path has no equivalent
  secondary-mount contract;
- network port/protocol guarantees, because Gondolin networking is
  hostname-granular and Docker protocol fidelity was not proved;
- brokered credentials, because allowed-origin delivery failed open in the
  retained Docker run;
- timeout/cancellation guarantees, because both delayed-marker oracles failed;
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

- The retained artifacts describe Docker v0.39.0 and Gondolin 0.9.1 workspace
  source on one Darwin arm64 host. They do not generalize across versions or
  operating systems without replay.
- DNS rebinding and a Gondolin read-only secondary mount remain unsupported.
- The probes make no paid Codex or Claude call. Deterministic fixtures are the
  authoritative containment evidence; provider calls would add cost and model
  variance without strengthening these oracles.
- The Docker credential failure may be adapter configuration or backend
  behavior. Until independently resolved, the correct evidence state is still
  failed-open.

## Supervisor checkpoint

Decision: **REJECT for production schema/persistence**.

Approval conditions:

1. both backends pass an acknowledged delayed-child termination oracle through
   the exact production execution wrapper, or lifecycle termination is moved to
   and verified at a stronger supervisor locus;
2. Docker passes allowed-origin synthetic credential delivery, rotation, and
   resume while retaining zero adjacent-origin matches;
3. the proposed vocabulary is replayed on the versions selected for production;
4. a supervisor signs an explicit approval entry before schema or public SDK
   work starts.
