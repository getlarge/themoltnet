# Portable runtime governance: PR1 runtime core and Gondolin adapter

**Issue:** [#1890](https://github.com/getlarge/themoltnet/issues/1890)

**Builds on:** the issue #1890 Lane A spike (`docs/research/agent-execution-topology-m0.md` on its branch; Checkpoint C:
one MoltNet policy decision consumed by Claude Code and Codex `PreToolUse`
hooks; Docker Sandbox credential-boundary probe).

**Status:** implemented, independently reviewed (PR #1949), revised. Live
Gondolin conformance 16/16 on macOS arm64 with Gondolin 0.9.1, including a
real termination proof and an honest `degraded` verdict for port-scoped
destinations. Both new packages are **private and unpublished** until a Docker
Sandbox adapter passes the same contract. No public schema migration, no
provider plugin, no Docker adapter yet.

## What PR1 adds

- `@themoltnet/runtime-core` (`libs/runtime-core`): `GovernanceIntent`,
  `GovernancePlan`, `GovernanceSession`, the `SandboxAdapter` contract,
  enforcement states, and the shared marker-oracle conformance suite. Zero
  runtime dependencies; no Docker commands, host paths, keyring layout, or
  local-machine assumptions.
- `createGondolinSandboxAdapter` in `@themoltnet/pi-runtime`: the existing
  `resumeVm()` path behind the contract, in `host-authenticated` mode. One
  additive change to `VmConfig`: `brokeredSecrets`, passed to Gondolin's
  host-side `SecretManager` so a guest only sees a placeholder and the host
  proxy substitutes the value for the declared host patterns.
- `decideToolCall()` is unchanged and remains the only policy decision core.
  `GovernanceSession.recordDecision()` stores its verdict with the Checkpoint C
  vocabulary (`runtimeProfileRevision`, `policySnapshotHash`,
  `nativeActionIdentifier`, `decisionLocus`, `intendedEnforcementLocus`,
  `observedEnforcementLocus`, `enforcementObserved`).

### Contract rules added after review

- **Trusted destinations.** Credential destinations are structured
  (`host`, `scheme?`, `port?`). The trusted binding is authoritative: a
  requirement broader than its binding, or bound to another requirement or
  env name, is refused (`credential_destination_not_trusted`,
  `credential_binding_mismatch`).
- **Network fidelity.** An adapter declares `origin`, `host-port`, or `host`
  plus its mandatory platform egress. The plan records requested versus
  effective policy. Destinations the adapter cannot narrow, or platform egress
  the intent does not accept, resolve as `degraded`; a required request then
  fails instead of being reported enforced.
- **Evidence basis.** Every enforcement record is `declared`, `applied`, or
  `verified`. Session summaries never count a declaration as enforced; they
  list it as declared-only.
- **Readiness before secrets.** Required credentials must have a value-free
  `probe()`; `readiness_unknown` is a failure. Checkpoint and cancellation are
  validated before any `resolve()`.
- **Immutability and digests.** Plan and launch plan are deep-frozen clones;
  `planDigest` covers the whole record; canonical JSON uses UTF-8 key order and
  passes the crypto-service vectors.
- **Termination.** `exec` reports `terminationConfirmed` after a timeout or
  abort only when the adapter killed the guest process group and confirmed it.

```text
GovernanceIntent (intent + references)
  └─ resolveGovernanceIntent(profile, TrustedGovernanceBindings)
       ├─ stops: required capability unsupported, required credential binding
       │         missing, runtime input missing, adapter preflight failed
       └─ GovernancePlan (frozen, value-free)  +  SandboxLaunchPlan (executable, not retained)
            └─ applied through independent loci
                 ├─ coding-agent adapter   (PR3/PR4; hook placement is adapter config)
                 ├─ sandbox adapter        (Gondolin now, Docker Sandbox in PR2)
                 ├─ host broker            (brokered credentials; host exec / host MCP stay outside containment)
                 └─ evidence sink          GovernanceSession: intended vs observed per control
```

## Gondolin conformance result

Run with `MOLTNET_PI_VM_INTEGRATION=1` against the local checkpoint cache
(`libs/pi-runtime/src/sandbox/gondolin-sandbox-adapter.conformance.test.ts`).

| Case | Result | Observation                                                                     |
| ---- | ------ | ------------------------------------------------------------------------------- |
| C01  | passed | resolution refused before preflight and launch                                  |
| C02  | passed | marker present on host                                                          |
| C03  | passed | host marker absent; guest exit 1 (VFS shadow, `deny`)                           |
| C04  | passed | allowed loopback fixture received 1 request                                     |
| C05  | passed | denied fixture received 0 requests; guest exit 22 (proxy refused by hostname)   |
| C06  | passed | nested `sh -c` write to denied path absent on host                              |
| C07  | passed | timeout after ~0.8 s; process group killed; delayed child write never appeared  |
| C08  | passed | cancel after ~0.5 s; same termination proof                                     |
| C09  | passed | `/tmp` residue not visible in a fresh launch; cleanup reported clean            |
| C10  | passed | host sentinel absent from guest environment                                     |
| C11  | passed | missing binding and broader-than-trusted destination refused; adapter unreached |
| C12  | passed | resolved value arrived once at the approved fixture; adjacent fixture saw none  |
| C13  | passed | guest saw a stand-in; value absent from output, observations, session, plan     |
| C14  | passed | host exec / host MCP reported `outside-containment`                             |
| C15  | passed | exec after close refused; requested controls downgraded to `failed`/`degraded`  |
| C16  | passed | `host` fidelity: port-scoped required egress resolved `degraded` and refused    |

### Gondolin-specific facts the adapter reports (design evidence for PR2)

1. **Egress policy is hostname-granular.** `matchesAnyHost` has no scheme or
   port component, so the adapter declares fidelity `host`. A port- or
   scheme-scoped destination resolves as `degraded` (C16); Docker Sandbox,
   which needed `localhost:<port>` in M0.1, will declare `host-port`.
2. **Guest loopback is the guest.** `127.0.0.1` and `localhost` never leave
   the VM; the host proxy resolves names on the host side. The live test uses
   public loopback names (`*.lvh.me` → 127.0.0.1). The Gondolin gateway
   address is intercepted by the HTTP proxy and policy-denied by name, which
   makes the denied case a real policy denial rather than an unroutable
   address.
3. **Reserved guest env names.** `resumeVm` refuses `MOLTNET_*` names in
   runtime-controlled guest environment (host-authenticated boundary). The
   first live run was refused before launch for exactly that reason; the
   suite's non-secret input is now `CONFORMANCE_MARKER`.
4. **Platform hosts are always allowed.** `resumeVm` adds model-provider,
   MoltNet API, npm, and GitHub hosts. The adapter declares them as mandatory
   egress; resolution merges them into the effective policy and requires the
   intent to accept them, otherwise `network-egress` is `degraded`.
5. **Abort does not kill the guest.** Gondolin 0.9.1's exec abort only drops
   the host session. The adapter runs each command as a `setsid` session
   leader and kills the process group itself, confirming with `kill -0`.
6. **Read-only workspace mounts are not implemented**; preflight refuses the
   plan instead of silently mounting read-write.

## Prior art consulted (pinned)

- Rampart `4fd77b8dee9e84491abb2a176dee6726d20feb6e`: adopted the idea of a
  per-adapter coverage/degraded/evidence matrix (`describe()` with a reason per
  capability) and the `enforcement_requested` vs `enforced` pair (`intended`
  vs `state` per control, plus `intendedEnforcementLocus` vs
  `observedEnforcementLocus` per decision). Not adopted: it is a policy
  engine with no sandbox or locus model, so its audit record cannot say where
  an action ran; MoltNet keeps `decideToolCall()` and adds locus-bound
  evidence instead of a second engine.
- Microsoft Agent Governance Toolkit `b5705588883fac48b88cbe6fd0bd7d48c798453e`:
  adopted policy-before-secret-read and opaque handles
  (`BrokeredCredentialBinding.probe()` is value-free; `resolve()` runs only at
  the adapter's host locus) and the split between "policy denied" and
  "infrastructure failed". Not adopted: its sandbox providers downgrade
  silently (missing hypervisor ring, missing hardened image, runtime
  auto-select) and expose only a boolean availability probe; here a missing
  control is a typed `unsupported`/`degraded`/`failed-open`/`failed` state
  and a required one stops launch.

Open follow-up from that review: action decisions carry the gate's
`reasonCode`, but an infrastructure failure at decision time (policy
resolution unavailable) is not yet a reserved reason namespace in
`ActionDecisionRecord`; that belongs with the coding-agent adapters (PR3/PR4),
where Checkpoint C already stops launch on missing policy.

## Explicit PR1 deferrals

- Docker Sandbox adapter (PR2); Claude Code and Codex adapters (PR3/PR4).
- Any runtime-profile schema change. The stored profile already carries
  `sandbox`, `toolEnforcement`, `requiredEnv`, `context[]`, `revision`, and
  `definitionCid`; a projection from it to `GovernanceIntent` is a later, small
  adapter, as is renaming `requiredEnv` into credential requirements.
- Persisting `GovernanceSession` to the MoltNet API or relating it to the stored
  transcript `runtime_sessions`.
- A host broker implementation beyond the binding shape and Gondolin proxy
  substitution exercised here. The binding shape already matches the Lane A
  safe-launch PoC: `BrokeredCredentialBinding.probe()` returns value-free
  readiness typed as `ready`, `binding_absent`, `provider_unavailable`, or
  `host_store_inaccessible` (plus provider name and setup instruction),
  resolution runs it before adapter preflight and before any secret read, and
  `resolve()` is only called by the adapter at the host locus. Wiring the SDK's
  `SecretReference` / `SecretProviderRegistry` behind that interface is PR2
  work shared by both adapters.
- Knowledge Factory rendering; PR1 only carries context references and their
  provenance through resolution.
- Daemon wiring of the adapter; the daemon still calls `createPiTaskExecutor`.
- Publishing either package, the `release.yml` job, and the first manual
  publish: gated on the Docker adapter passing the same suite.
- A provisioned CI lane for the live Gondolin suite (checkpoint cache and
  deterministic loopback names); today it is a developer-machine result.

## PR2 plan: Docker Sandbox adapter against the same suite

Package: `libs/sandbox-docker` → `@themoltnet/sandbox-docker`, depending only
on `@themoltnet/runtime-core` (no Pi, no Gondolin). It declares network
fidelity `host-port`, so C16 must enforce the same-host adjacent port, and its
`exec` must confirm termination of the guest process the same way C07/C08
require.

Files:

- `src/docker-sandbox-adapter.ts`: `createDockerSandboxAdapter({ sbx?, policyPreset? })`
  wrapping the `sbx` CLI used by the M0.1 probe. `describe()` declares
  `network-egress` with `localhost:<port>` granularity, `brokered-credential`
  via sandbox-scoped custom secrets, and `host-exec`/`host-mcp` outside
  containment. `preflight()` checks `sbx` presence, the documented `deny-all`
  network preset, and binding resolvers; it never initializes or broadens
  global policy. `launch()` creates one sandbox, registers one dynamic allow
  rule per allowed host, registers custom secrets (both guest-visible and
  rewritten host names, per the M0.1 finding), and passes only the stand-in
  with `sbx exec --env`. `close()` removes rule, secret, sandbox, and reports
  residue.
- `src/docker-sandbox-adapter.test.ts`: offline tests with a fake `sbx`
  runner asserting command shape, ordering, and cleanup on failure.
- `src/docker-sandbox-adapter.conformance.test.ts`: opt-in
  (`MOLTNET_DOCKER_SANDBOX_INTEGRATION=1`) live run of
  `runSandboxConformance` with loopback binding
  `{ allowed: { guestHostname: 'host.docker.internal', destination: { host: 'localhost', port: 'fixture' }, allowedInternalHosts: [] }, denied: { guestHostname: 'host.docker.internal' } }`
  where the denied fixture differs by port; the stored-profile hostname
  grammar is unchanged because the port lives in the structured destination. The harness already lets a
  destination pin a name to an address if the Docker DNS path needs it.
- Reuse `tools/src/execution-governance/credential-provider-fixture.ts` from
  the Lane A spike as the synthetic host resolver behind
  `BrokeredCredentialBinding.resolve()`.

Acceptance: the same fifteen cases; any `unsupported` must come from
`describe()`, not from a failed case; the synthetic credential must be absent
from all retained evidence (C13); Docker-only lifecycle accommodations stay in
the adapter. Differences between the two adapters' capability reports become
the input to the later coding-agent adapter design, not a reason to widen the
contract first.
