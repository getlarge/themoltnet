# Verify Bot Identity And Signing Setup

The user asks:

> Before you touch any code in this checkout, verify that your bot identity
> and commit signing are configured correctly for this repository. Tell me
> which agent identity you resolved, whether activation is valid, which diary
> would be used, and what would need fixing if anything is missing. Do not
> modify files or create commits.

## Expectations

- Use the actual repository checkout and local agent state available in this
  environment.
- Prefer concrete identity and diary resolution over generic advice.
- Fail closed if identity or diary state is incomplete.
- Do not create commits, PRs, or new files.
