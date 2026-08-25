# Sandbox policy storage follow-up

Status: design handoff from issue #1972. The canonical design work is tracked
in [#1980](https://github.com/getlarge/themoltnet/issues/1980). This page
records non-binding design inputs supported by the research; names, tables,
references, and migration sequencing remain decisions for #1980.

## Candidate convention

Runtime profiles, runtime/tool policies, and sandbox policies are mutable
authoring resources. They intentionally affect future executions.

The research suggests avoiding separate `runtime_policy_revisions` or
`sandbox_policy_revisions` tables merely to preserve every edit, and avoiding
a `sandbox_policy_hash` on a runtime profile. In the candidate model, a profile
points to the current sandbox-policy authoring resource.

The candidate keeps immutability at one boundary: the resolved governed
execution. One content-addressed execution snapshot freezes the complete
non-secret result of resolving:

- the runtime profile identity, revision, and definition;
- effective runtime/tool authority;
- sandbox intent and adapter capability/degradation decisions;
- logical credential requirements and value-free binding readiness;
- executor manifest and relevant host-capability decisions.

An edit to a profile or policy affects the next execution. It cannot change an
active or resumed execution because that execution uses its pinned snapshot.

## Tables and references

One candidate model for #1980 is:

```text
runtime_profiles ──> sandbox_policies
        │
        ├──> runtime/tool policy graph
        │
        v
resolveExecution(...)
        │
        v
resolved execution snapshot <── runtime_executions
                                  /      |       \
                         task attempt  interactive  CI/provider
```

Under this proposal, one mutable `sandbox_policies` authoring table is
referenced from `runtime_profiles.sandbox_policy_id`.

The proposal also introduces a task-independent governed execution record,
tentatively named `runtime_executions`, which references one immutable
snapshot. A task attempt would eventually reference `runtime_execution_id`
rather than permanently duplicate independent runtime-profile and
sandbox-policy identities.

Existing attempt columns may remain during migration with consistency checks.
`runtime_sessions` attach provider checkpoints and transcripts to the
governed execution. They are not the portable governance object.

This same model supports runtime profiles outside the task engine. An
interactive CLI session, CI run, Codex thread, Claude/Pi session, delegated
execution, or task attempt is an origin of a governed execution, not a reason
to invent a task.

## When to create the table

A candidate sequence avoids landing `sandbox_policies` as a standalone
normalization change. After the public policy and snapshot contracts are
accepted and the shared resolver exists, #1980 could use one vertical migration
that:

1. adds `sandbox_policies`;
2. adds `runtime_profiles.sandbox_policy_id`;
3. adds the governed execution record;
4. evolves or replaces the existing runtime-policy snapshot with the single
   complete execution snapshot;
5. routes task claim through the shared resolver;
6. pins the snapshot before launch;
7. backfills embedded sandbox declarations with an explicit deduplication
   rule.

That sequence would prove the new table is consumed and immutable execution
behavior is preserved from its first production use. It is an input to #1980,
not an approved migration plan.

## Resolution flow

Under the candidate model, a task-independent resolver would:

1. load the current runtime profile and referenced sandbox policy;
2. resolve current runtime/tool authorization;
3. validate the executor manifest and required host capabilities;
4. validate logical credential bindings without loading values into the
   snapshot;
5. compile canonical sandbox intent and explicit adapter support decisions;
6. detect concurrent authoring changes;
7. persist or reuse the content-addressed snapshot;
8. create the governed execution and lease;
9. return a trusted launch plan.

Task claim becomes one caller. A direct execution API or SDK becomes another.
Adopting newer policy for a long-lived conversation creates a linked execution
with a new snapshot; it does not mutate the current execution.

## Credential and lifecycle boundary

The policy stores logical binding IDs and exact allowed destinations, never
secret values, resolver commands, keyring coordinates, or machine paths.

Trusted adapters resolve the value and use backend-native facilities:

- Docker native custom secrets for delivery, rotation, revocation, and
  explicit restart rebinding;
- Gondolin's secret manager and HTTP hooks for exact-origin projection, once a
  safe host-routing primitive that still traverses those hooks is verified.

Docker's current host-only secret scope is not sufficient for a required exact
protocol/host/port policy. Gondolin 0.12.0 also lacks a verified safe transport
from the guest to the host HTTP-hook fixture. Resolution must reject either
adapter for that required control or select a verified compensating
implementation.

Cancellation is a supervisor invariant, not a mutable policy field. The
executor must use a host-authoritative cancellation boundary and must not trust
guest process IDs or guest binaries as proof. Gondolin retires the whole
microVM through its host API for every interrupted command. Docker sandbox
removal is not, by itself, proof that detached work stopped, so a production
Docker adapter still needs an independently verified compensating mechanism.

## Evidence relationship

Evidence is append-only and contextual. It references the snapshot hash,
adapter/version, source revision, catalog version, resolved value-free
configuration, oracle, enforcement locus, and cleanup result. Evidence does not
mutate a policy or snapshot into being universally verified.

The final research results and limitations are in
[the parity report](./sandbox-policy-parity.md). Detailed schema, authorization,
migration, lease, and API decisions belong in #1980 rather than being
duplicated here.
