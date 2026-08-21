# @themoltnet/runtime-core

Portable MoltNet runtime governance core. It is the smallest surface that lets a
MoltNet runtime profile be resolved and applied through sandboxes and coding
agents MoltNet does not own, while keeping every enforcement claim truthful.

It contains no policy engine. Tool decisions stay in
`decideToolCall()` from `@themoltnet/pi-runtime`; this package records that
decision next to the sandbox evidence it was made under.

## Three stages, kept distinct

| Stage                    | Type                     | Mutability         | Contains                                                                                                                                                          |
| ------------------------ | ------------------------ | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime profile          | `RuntimeProfile`         | editable intent    | profile ref, tool-policy intent, sandbox intent, capability requirements, credential requirements, context references, host powers                                |
| Resolved runtime profile | `ResolvedRuntimeProfile` | frozen, value-free | profile revision, policy snapshot hash, selected adapter, per-capability verdict and locus, credential binding references, context provenance, launch-plan digest |
| Runtime session          | `RuntimeSession`         | frozen on finish   | enforcement records (intended vs observed, per locus), action decisions, cleanup report, outcome                                                                  |

Trusted local or deployment configuration (`TrustedRuntimeBindings`) sits
between the first two stages: it names the sandbox adapter, the workspace host
path, credential resolvers, and context revisions. Only value-free references
from it reach the resolved profile; host paths, resolvers, and values never do.

`RuntimeSession` here is an enforcement-evidence record. It is unrelated to the
stored `runtime_sessions` transcript objects in the MoltNet API.

## Enforcement states

Every control reports one of `enforced`, `unsupported`, `degraded`,
`failed-open`, or `failed`, with a locus (`guest-sandbox`, `host-broker`,
`coding-agent-hook`, `outside-containment`). Host exec and host MCP are always
reported outside guest containment. Loss of a control maps by requirement:
required → `failed`, preferred → `degraded`, not requested but previously
active → `failed-open`. Nothing is ever collapsed into one coverage flag.

## Sandbox adapter contract

```ts
interface SandboxAdapter {
  id: string;
  version: string;
  describe(): SandboxCapabilityReport; // static, per-capability state + locus
  preflight(plan: SandboxLaunchPlan): Promise<PreflightResult>; // no launch, no secret read
  launch(plan, { signal? }): Promise<SandboxHandle>;
}
interface SandboxHandle {
  guestWorkspace: string;
  exec(command, { timeoutMs?, signal?, env?, cwd? }): Promise<SandboxExecResult>;
  observe(): readonly EnforcementRecord[];
  close(): Promise<SandboxCleanupReport>;
}
```

`SandboxLaunchPlan` is portable except for the workspace host path, which is a
trusted binding supplied at launch. Credentials travel as
`BrokeredCredentialBinding` (requirement id, env name, destination hosts,
non-secret binding ref, host-side `resolve()`); adapters resolve as late as
possible and deliver only to the declared destinations.

Implementations: `createGondolinSandboxAdapter` in `@themoltnet/pi-runtime`
(PR1). Docker Sandbox follows in PR2 against the same suite.

## Conformance suite

`runSandboxConformance({ adapter, harness })` runs fifteen marker-oracle cases.
Oracles are independent of the adapter: files in the host workspace and
loopback HTTP fixtures that count requests and whether the expected credential
arrived. Results are `passed`, `failed`, `unsupported`, or `skipped`; an
adapter that declares a capability unsupported gets `unsupported`, never
`passed`.

| Case | Oracle                                                          |
| ---- | --------------------------------------------------------------- |
| C01  | required capability missing → resolution stops before preflight |
| C02  | allowed write → marker present on host                          |
| C03  | denied write → marker absent on host                            |
| C04  | allowed destination → fixture hit                               |
| C05  | adjacent denied destination → zero hits                         |
| C06  | nested `sh -c` write to denied path → marker absent             |
| C07  | hard timeout honoured                                           |
| C08  | cancellation honoured                                           |
| C09  | guest mutation absent after close + relaunch                    |
| C10  | host env sentinel absent from guest                             |
| C11  | missing credential binding → resolution stops with a diagnostic |
| C12  | credential reaches exactly one approved destination             |
| C13  | credential value absent from output, observations, evidence     |
| C14  | host exec / host MCP reported outside containment               |
| C15  | exec after close refused; no enforced claim survives            |

`createNodeConformanceHarness` provides the workspace and loopback fixtures.
Adapter tests supply the loopback binding (how the guest names the host
loopback), which is the only adapter-specific input. An in-memory
`createReferenceSandboxAdapter` runs the suite in CI to test the suite itself;
it is not a sandbox and says so in its capability report.

## Knowledge Factory and credentials

A profile may carry `ContextReference`s (slug, binding, pinned revision).
Resolution records revision and provenance from trusted bindings and warns when
a reference is unpinned. Context informs the agent; it is never an enforcement
claim. Credential requirements are value-free; resolution fails with a setup
diagnostic when a required binding is absent on this machine.
