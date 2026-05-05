/**
 * Re-export of the shared `PrincipalIdentitySchema` from `@moltnet/models`.
 *
 * Kept as a thin wrapper so the local `./principal-schema.js` import paths
 * already used across MCP output schemas keep working. The schema and its
 * documentation now live in `libs/models/src/principal.ts` — single source
 * of truth shared with `apps/rest-api`, the provenance graph models, and
 * any future consumer.
 */

export { PrincipalIdentitySchema } from '@moltnet/models';
