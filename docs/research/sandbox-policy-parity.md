# Sandbox policy parity: production decision record

Status: research completed for issues #1972 and #2004–#2007. The experimental
replay harness and generated JSON are intentionally not retained in the source
tree. This document records only the decisions that affect production code.

## Result

Docker Sandbox and Gondolin are not feature-equivalent. An adapter must be
selected from its explicit capabilities, and selection must fail before launch
when a required control is unsupported, degraded, failed, or failed open.

The final #2007 replay ran the 52-case v2 catalog from signed implementation
revision `a2f2958a57877f9bd14a478f59dd426173016a6b`:

| Backend        | Version | Enforced | Failed open | Unsupported | Cleanup  | Eligible |
| -------------- | ------: | -------: | ----------: | ----------: | -------- | -------- |
| Docker Sandbox | v0.39.0 |       24 |           2 |          26 | complete | no       |
| Gondolin       |  0.12.0 |       23 |           0 |          29 | complete | no       |

Counts are an inventory, not a score. No negative result was promoted without
a healthy positive fixture baseline. Both runs had zero evidence-validation
violations and retained no credential or machine path.

## Gondolin production boundary

The useful Gondolin findings now live in `@themoltnet/sandbox-gondolin`, where
normal VM resumes consume them:

- brokered HTTP credentials are matched against canonical protocol, hostname,
  and port;
- hostnames are case-folded, root dots are removed, IDNA is converted to ASCII,
  and IPv4/IPv6 literals are normalized;
- ambiguous alternate numeric IP forms are rejected from credential policy;
- credential wildcards are limited to `*` or a leading, one-label `*.` pattern;
- wildcard matching does not include the suffix itself, deeper subdomains, or
  lookalike suffixes;
- credential destinations must be covered by the effective Gondolin network
  policy before the VM starts;
- the production path always uses Gondolin's default fetch so the accepted DNS
  result remains pinned to the actual upstream connection.

The research-only TEST-NET-to-loopback fetch seam was removed. Although useful
for deterministic probing, a custom fetch bypasses Gondolin 0.12's
connect-time IP-pinned dispatcher and therefore must not be a production API.

Gondolin 0.12.0 did not independently establish portable enforcement for raw
TCP, generic proxy bypass, every redirect variant, controlled resolver changes,
deny-all egress, or read-only secondary mounts. Those capabilities remain
unsupported unless a future production implementation and replay prove them.

## Docker production boundary

Docker Sandbox v0.39.0's native custom-secret binding is hostname-scoped, not
exact-origin scoped. It delivered a credential to an independently allowed
adjacent port, and native stop/remove did not promptly contain detached work.
Those are the two observed failed-open controls in the final replay.

The research prototype showed that trusted-host compensators can close those
gaps for the pinned version:

- an upstream proxy can terminate the HTTP tunnel, canonicalize and pin the
  CONNECT authority and route, require an admitted inner origin, and strip
  credentials outside the protected origin;
- the dedicated daemon's private Engine socket can identify and kill the exact
  sandbox container, with CLI stop/remove retained only for cleanup.

These mechanisms are version-coupled and are not retained as tooling here.
[#2038](https://github.com/getlarge/themoltnet/issues/2038) owns their
production implementation, tests, version pin, and supported boundary. Do not
create or select `libs/sandbox-docker` until that work is complete.

## Portable policy implication

The research supports a portable vocabulary, not a lowest-common-denominator
implementation:

- workspace access and denial outside the workspace;
- destination intent with protocol, canonical host, and port;
- logical credential requirements bound to exact destinations, never values;
- resource limits;
- host-authoritative timeout and cancellation containment;
- explicit native, compensated, unsupported, degraded, failed, or failed-open
  adapter decisions.

Requested intent, adapter resolution, applied state, and verified evidence must
remain separate. [#1980](https://github.com/getlarge/themoltnet/issues/1980)
owns the public policy and governed-execution model. Persistence should land
only as a vertical slice that resolves and pins a complete execution; see
[the storage follow-up](./sandbox-policy-storage-follow-up.md).

## Evidence retention

Generated replay JSON, fixture catalogs, protocol servers, adapter probes, and
prototype compensators are not product assets and are not kept in Git. Their
purpose was to answer the package-boundary question; retaining them would make
the repository carry a second, non-production implementation indefinitely.

The signed implementation and replay commits preserve the audit trail in Git
history. This decision record preserves the version pins, aggregate outcomes,
unsupported boundary, and follow-up ownership needed for implementation. A
future compatibility claim must be produced by the owning package's tests and
CI/release evidence for the exact backend version; it must not revive a
permanent repository-wide research catalog.
