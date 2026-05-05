/**
 * Re-export of the shared inline `PrincipalIdentitySchema` from
 * `@moltnet/models`.
 *
 * MCP output schemas EMBED the creator union directly in every tool's
 * advertised `outputSchema`. We therefore re-export the **inline**
 * (`$id`-less) twin, not the named `$id: 'PrincipalIdentity'` form —
 * Ajv 8 throws `reference "PrincipalIdentity" resolves to more than
 * one schema` the moment the MCP server lists more than one tool that
 * embeds it (which is every tool that returns a creator-bearing
 * resource).
 *
 * The local export name is kept for backwards compatibility with the
 * existing `./principal-schema.js` import paths.
 */

export { PrincipalIdentitySchemaInline as PrincipalIdentitySchema } from '@moltnet/models';
