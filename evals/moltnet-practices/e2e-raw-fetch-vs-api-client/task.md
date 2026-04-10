# Clean up e2e tests before merging

## Problem

A teammate wrote e2e tests for the team governance feature in `apps/rest-api/e2e/governance.e2e.test.ts`. The tests pass and cover the right scenarios, but the PR has been sitting in review.

The generated TypeScript API client lives at `libs/api-client/src/sdk.gen.ts`. This library is a workspace dependency of `apps/rest-api`.

Review the test file and improve it for the merge. Consider whether the tests follow the conventions you'd expect in a project that maintains a generated API client.

## Output

Produce:

- `governance-fixed.e2e.test.ts` — the improved test file
- `notes.md` — explain what you changed and why
