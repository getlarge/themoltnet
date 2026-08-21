# @themoltnet/runtime-core

Portable MoltNet runtime governance core. It is the smallest surface that lets a
MoltNet runtime profile be resolved and applied through sandboxes and coding
agents MoltNet does not own, while keeping every enforcement claim truthful.

**Status: private and unpublished** until a second sandbox adapter (Docker
Sandbox) passes the same conformance contract. The public names below are
governance vocabulary (`GovernanceIntent`, `GovernancePlan`,
`GovernanceSession`) so they cannot be confused with the stored production
`RuntimeProfile`, the daemon's `ResolvedRuntimeProfile`, or the transcript
`RuntimeSession`.

It contains no policy engine. Tool decisions stay in `decideToolCall()` from
`@themoltnet/pi-runtime`; this package records that decision next to the
sandbox evidence it was made under.

## Three stages, kept distinct

| Stage              | Type                | Mutability                | Contains                                                                                                                                                                                                                    |
| ------------------ | ------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Governance intent  | `GovernanceIntent`  | editable                  | profile ref, tool-policy intent, sandbox intent (filesystem, structured network destinations, resources), capability requirements, value-free credential requirements, context references, host powers                      |
| Governance plan    | `GovernancePlan`    | deeply frozen, value-free | profile revision, policy snapshot hash, adapter, per-capability verdict and locus, requested vs effective network policy and fidelity, credential bindings with readiness, context provenance, launch-plan and plan digests |
| Governance session | `GovernanceSession` | deeply frozen on finish   | enforcement records with evidence basis (`declared` / `applied` / `verified`), action decisions, cleanup report, outcome                                                                                                    |

`TrustedGovernanceBindings` sits between the first two stages: the sandbox
adapter, the workspace host path, credential bindings, context revisions. Only
value-free references from it reach the plan; host paths, resolvers, and
values never do. The executable `SandboxLaunchPlan` is returned alongside the
plan, deeply frozen, and is not evidence.

## What resolution refuses before any launch or secret read

- a required capability the adapter declares `unsupported` or `degraded`;
- a required credential with no trusted binding, a binding bound to a
  different requirement or env name, or a requirement naming a destination the
  binding does not cover (the trusted side is authoritative);
- a required credential whose value-free `probe()` is missing
  (`readiness_unknown`) or reports `binding_absent`, `provider_unavailable`,
  or `host_store_inaccessible`;
- a requested destination narrower than the adapter's network fidelity
  (`origin` > `host-port` > `host`), or mandatory platform egress the intent
  does not accept — both resolve `network-egress` as `degraded`;
- a missing runtime input or a failed adapter preflight.

## Enforcement states and evidence basis

Every control reports `enforced | unsupported | degraded | failed-open |
failed` with a locus (`guest-sandbox`, `host-broker`, `coding-agent-hook`,
`outside-containment`) and a basis. `declared` is the adapter's static claim
and is never counted as enforced in a session summary; `applied` means the
adapter configured the control for this launch; `verified` means an
independent oracle confirmed it. Host exec and host MCP are always outside
guest containment. Loss of a control maps by requirement: required → `failed`,
preferred → `degraded`, unrequested but active → `failed-open`.

## Sandbox adapter contract

```ts
interface SandboxAdapter {
  id: string;
  version: string;
  describe(): SandboxCapabilityReport; // capabilities + network { fidelity, mandatoryEgress } + host powers
  preflight(plan: SandboxLaunchPlan): Promise<PreflightResult>; // no launch, no secret read
  launch(plan, { signal? }): Promise<SandboxHandle>;
}
interface SandboxHandle {
  guestWorkspace: string;
  exec(command, { timeoutMs?, signal?, env?, cwd? }): Promise<SandboxExecResult>; // terminationConfirmed after timeout/abort
  observe(): readonly EnforcementRecord[]; // with evidence basis
  close(): Promise<SandboxCleanupReport>; // idempotent; residue retained
}
```

Implementation: `@themoltnet/sandbox-gondolin` (private). Docker Sandbox
follows against the same suite.

## Conformance suite (`@themoltnet/runtime-core/conformance`)

Sixteen marker-oracle cases; oracles are host workspace files and loopback
HTTP fixtures that count requests and whether the expected credential
arrived. An adapter that declares a capability unsupported gets
`unsupported`, never `passed`.

| Case | Oracle                                                                                   |
| ---- | ---------------------------------------------------------------------------------------- |
| C01  | required capability missing → resolution stops before preflight                          |
| C02  | allowed write → marker present on host                                                   |
| C03  | denied write → marker absent on host; control recorded as applied, not just declared     |
| C04  | allowed destination → fixture hit                                                        |
| C05  | adjacent denied destination → zero hits                                                  |
| C06  | nested `sh -c` write to denied path → marker absent                                      |
| C07  | timeout → process group killed; delayed child write never appears; termination confirmed |
| C08  | cancellation → same proof as C07                                                         |
| C09  | guest mutation absent after close + relaunch; close is idempotent                        |
| C10  | host env sentinel absent from guest                                                      |
| C11  | missing binding and broader-than-trusted destination both refused                        |
| C12  | credential reaches exactly one approved destination                                      |
| C13  | credential value absent from output, observations, plan, session, launch plan            |
| C14  | host exec / host MCP reported outside containment                                        |
| C15  | exec after close refused; no enforced claim survives                                     |
| C16  | same-host port narrowing enforced, or honestly refused as `degraded` at `host` fidelity  |

The runner aggregates cleanup across every handle it launched; residue fails
the run. `createReferenceSandboxAdapter` runs the suite in CI to test the suite
itself; it is not a sandbox and says so in its capability report.
