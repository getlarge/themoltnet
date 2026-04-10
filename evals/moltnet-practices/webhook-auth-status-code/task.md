# Fix a webhook authentication handler

## Problem

The Ory Kratos identity server calls a webhook on `apps/rest-api/src/routes/hooks.ts` after each user registration. The webhook handler validates an API key before processing.

A QA engineer reported that when the webhook is called with a wrong API key, the Kratos registration flow terminates with an opaque "An internal error occurred" message in the UI. The registration itself seems to be created in Kratos, but the post-registration steps (OAuth2 client creation, default permissions) don't execute.

Look at the webhook handler and fix the issue. Pay attention to what HTTP status codes mean to Kratos when it calls webhooks.

## Output

Produce:

- `hooks-fixed.ts` — the corrected webhook handler
- `notes.md` — explain the root cause and why your fix resolves the UX issue
