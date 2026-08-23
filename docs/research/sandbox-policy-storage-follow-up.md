# Sandbox policy storage follow-up

Status: design proposal only. The remediated issue #1972 research checkpoint
approves a portable vocabulary for design work, but this document authorizes no
schema, migration, API, or SDK change.

## Question

After enforcement parity is good enough, should reusable containment intent be
stored as a first-class `sandbox_policies` resource instead of remaining
embedded in runtime profiles?

The answer is provisionally yes. The current Docker v0.39.0 and Gondolin 0.12.0
runs have no failed-open controls, but storage must still preserve the
separation between portable intent, trusted adapter binding, and observed
evidence.

## Candidate resource

A future resource could contain:

- stable policy ID, owner/team scope, display name, and lifecycle metadata;
- a canonical versioned policy document containing only approved portable
  fields;
- an immutable content hash computed from canonical UTF-8 JSON;
- optional supersession metadata, never in-place semantic mutation;
- no secret value, provider coordinate, machine path, checkpoint path, backend
  resource ID, or evidence success flag.

Runtime profiles would reference a policy revision by ID plus immutable hash.
They would retain runtime-specific declarations that are not sandbox policy.
Trusted local configuration would resolve backend bindings separately.

## Claim-time pinning

Task claim should resolve and pin all of the following in one durable decision:

1. runtime-profile revision;
2. sandbox-policy ID and immutable hash;
3. adapter identity and version requirement;
4. value-free trusted-binding IDs;
5. the effective enforcement receipt produced at launch.

A retry must use the same pinned policy hash unless an explicit supervisor
transition creates a new attempt. This prevents policy drift between claim,
launch, resume, and evidence review.

## Impact preview

Before an operator activates or supersedes a policy, an impact preview should
list:

- runtime profiles and queued/running tasks that reference it;
- backend adapters that can enforce, degrade, or do not support each control;
- requested versus expected effective network destinations;
- required trusted bindings without exposing their provider coordinates;
- whether current verified evidence covers the selected adapter version;
- resumable tasks whose checkpoint semantics would change.

There must be no aggregate pass percentage. Required failed-open, failed, or
unsupported controls are shown individually and block activation unless an
explicit higher-level policy defines a safe degradation.

## Evidence relationship

Evidence should be append-only and separate from the policy resource. A receipt
references the policy hash, adapter/version, resolved value-free binding, source
revision, scenario catalog version, independent oracle, enforcement locus, and
cleanup result. It must not mutate the policy into “verified.” Verification is
always contextual to a backend version and run.

## Migration outline after approval

1. approve the portable vocabulary through the supervisor checkpoint;
2. design authorization and ownership rules for policy resources;
3. add the resource and immutable revision storage in a dedicated migration;
4. dual-read embedded profile policy and referenced policy revisions;
5. backfill canonical hashes and produce an impact preview;
6. pin policy hashes at task claim and record launch receipts;
7. migrate writers, then remove the embedded form only after compatibility and
   rollback windows pass.

Each step needs its own issue and migration review. No part of this outline is
implemented by issue #1972.

## Credential and cancellation contract

The replay established a backend-neutral lifecycle without copying credentials
into guest storage:

1. resolve a value-free binding ID in trusted host configuration;
2. put only a non-secret placeholder in the guest environment;
3. bind the real value at the host proxy/hook to exact approved origins;
4. rotate by replacing the host binding while keeping the placeholder stable;
5. revoke by removing the host binding and verifying zero delivery;
6. restore after restart/resume only through an explicit rebind operation.

The policy stores the binding ID and allowed origins, never the value, resolver
command, keyring coordinate, or machine path.

Every guest command also runs in a fresh process group. Timeout or cancellation
sends TERM, escalates to KILL, and confirms that the group no longer exists.
Backend destruction is the stronger fallback when that confirmation cannot be
obtained. For Docker detached launchers, stdin/stdout/stderr must be closed so
the launcher actually returns before the termination control exec begins.

## Open decisions

- whether policy revisions are rows or content-addressed immutable documents;
- how team grants apply to reuse versus mutation;
- whether activation requires recent evidence for every supported production
  adapter/version;
- how an emergency deny-only overlay interacts with a pinned policy;
- retention and redaction rules for evidence artifacts;
- which supervisor role can accept an explicitly degraded optional control.
