# Publishable Skill Surface

The user asks:

> Draft the command/code path this publishable skill should use for proposing
> issue #456. This must work outside the MoltNet repository, so do not use
> internal pnpm workspace scripts.

## Expectations

- Avoid `pnpm --filter @moltnet/tools task:fulfill-brief`.
- Use a published SDK based JavaScript ESM snippet for task creation.
- Use released MoltNet CLI only for operational helpers such as minting the
  GitHub App token.
- Fail closed instead of falling back to a human GitHub token.
- Mention public docs rather than internal-only tooling as the external user
  reference point.
