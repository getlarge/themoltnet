# Execution plan

`@moltnet/execution-plan` is the portable compiler boundary for governed
executions. It turns resolved intent and authority plus an executor capability
offer into a deterministic, value-free plan.

```text
requested intent
  -> resolved authority snapshot
  -> executor capability offer
  -> compiled execution plan
  -> immutable content-addressed snapshot
```

## Ownership

The package owns:

- `ExecutionIntent`: profile revision and definition CID, the current effective
  policy snapshot pin, resolved portable control authority, credential and host
  capability requirements, lease controls, and network intent;
- `ExecutionCapabilityOffer`: executor identity and open-ended control IDs with
  native or compensated enforcement, locus, and exact constraints;
- value-free credential readiness records;
- `compileExecutionPlan`, snapshot creation and verification, and
  `explainExecutionPlan`.

The compiler consumes resolved authority. RuntimeProfile-to-RuntimePolicy
relations are resolved elsewhere into the existing unioned, content-addressed
policy snapshot. Policy IDs never cross this boundary and policy composition is
never reimplemented here.

## Portability rule

This package has no dependency on a concrete runtime, sandbox, orchestrator,
product profile, host configuration, secret provider, or adapter name. Control
IDs and enforcement loci are open-ended. A new executor participates by
publishing an offer; compiler code does not branch on its name.

## Security invariants

- Missing authority, readiness, exact containment, or a required offer fails
  closed.
- Optional controls may degrade but never widen network intent.
- Credential destinations remain exact protocol/host/port tuples.
- Native and compensated enforcement remain distinguishable in the plan.
- Intent, plans, explanations, and snapshots contain no credential values or
  provider coordinates.
- Snapshot content addresses pin the intent, resolved authority, offer,
  readiness, and resulting plan together.

Lifecycle, scoped credential delivery, adapter binding, and applied/verified
evidence belong to `@moltnet/runtime-execution`. Product-specific profile,
manifest, provider, and sandbox projections belong to the private
`@moltnet/execution-integrations` package.
