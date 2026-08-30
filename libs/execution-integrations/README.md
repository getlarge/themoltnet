# @moltnet/execution-integrations

Private product integrations around the portable execution compiler. The root
package intentionally exports nothing; consumers select an explicit boundary:

- `./runtime-profile` maps an already-resolved profile and content-addressed
  effective policy snapshot into portable intent. It never composes policies.
- `./pi` converts the canonical Pi executor manifest into a generic capability
  offer.
- `./gondolin` projects exact plan tuples into canonical Gondolin launch types
  and supplies the concrete execution adapter.
- `./credential-broker` checks host readiness and resolves canonical secret
  references only inside a scoped delivery callback.

Dependency direction is one-way: integrations depend on portable planning and
lifecycle packages; neither portable package imports product or runtime types.

## Running unit tests

Run `nx test execution-integrations` to execute the unit tests via [Vitest](https://vitest.dev/).
