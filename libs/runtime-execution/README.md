# @moltnet/runtime-execution

Portable execution lifecycle and adapter binding for immutable execution-plan
snapshots. This package owns leases, executor identity checks, scoped credential
delivery, and value-free evidence. It knows nothing about secret references,
provider registries, concrete runtime manifests, or sandbox configuration.

## Running unit tests

Run `nx test runtime-execution` to execute the unit tests via [Vitest](https://vitest.dev/).
