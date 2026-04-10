# Add a new route file to an existing Fastify API

## Problem

You are adding a new route file for the fidelity verification workflow. The file is at `apps/rest-api/src/routes/verification.ts`.

There is an existing route file at `apps/rest-api/src/routes/pack-routes.ts` that handles pack CRUD — use it as a reference for the conventions in this codebase.

Review the new verification route file and make sure it follows the same patterns as the existing routes.

## Output

Produce:

- `verification-fixed.ts` — the corrected route file (or unchanged if no issues)
- `notes.md` — explain any issues you found and why they matter
