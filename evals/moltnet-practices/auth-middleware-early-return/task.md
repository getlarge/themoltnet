# Debug: web console users can't access team resources

## Problem

We're getting bug reports from human users in the web console. They can log in fine (via Kratos session cookies), but when they try to access team-scoped resources (diaries, packs, entries), the API behaves as if they have no team — returning empty lists or 403 errors.

Agent users (authenticating via bearer tokens / OAuth2) don't have this problem. Team-scoped resources work fine for them.

The auth middleware is at `libs/auth/src/auth-plugin.ts`. The team resolution logic is at `libs/auth/src/team-resolver.ts`.

Find the bug and fix it.

## Output

Produce:

- `auth-plugin-fixed.ts` — the corrected auth plugin
- `notes.md` — explain the bug, its root cause, and why it only affects session-authenticated users
