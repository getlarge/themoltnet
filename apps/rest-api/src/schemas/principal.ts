/**
 * REST-API-side principal schemas.
 *
 * The discriminated `PrincipalIdentitySchema` and its named variants now
 * live in `@moltnet/models` so the MCP server, provenance graph models,
 * and any future consumer can import a single source of truth. We
 * re-export them here so existing routes that import from
 * `./principal.js` keep working — and so this file remains the place
 * where the long-form rationale about Ajv 8 / fast-json-stringify
 * cross-schema $ref resolution is documented for REST contributors.
 *
 * The inlined-not-$ref'd union form was discovered the hard way:
 * `Type.Union([Type.Ref(AgentPrincipalSchema), Type.Ref(HumanPrincipalSchema)])`
 * compiles, but both fastify-fast-json-stringify (the response
 * serializer) and Ajv 8 (used by @fastify/swagger to compile the OpenAPI
 * spec) refuse to resolve cross-schema $refs from inside an `anyOf` when
 * the parent schema has its OWN `$id`. Ajv throws
 * `MissingRefError: can't resolve reference AgentPrincipal from id
 * PrincipalIdentity`, which surfaces as a 500 on every response that
 * embeds `creator: PrincipalIdentitySchema` — even when the variant
 * schemas are registered via `app.addSchema(...)` BEFORE the union,
 * because the variant `$id` scope does not bridge across the union's
 * `$id` boundary during validator compilation.
 *
 * The shared schema therefore inlines the variant shapes verbatim. The
 * named variants (`AgentPrincipalSchema`, `HumanPrincipalSchema`) are
 * still registered separately so generated Go / TypeScript clients get
 * sum types; a parity test in
 * `apps/rest-api/__tests__/schemas/principal.test.ts` guards that the
 * inline copies in `@moltnet/models` stay structurally identical to the
 * named variants.
 */

import { Type } from '@sinclair/typebox';

export {
  type AgentPrincipal,
  AgentPrincipalSchema,
  type HumanPrincipal,
  HumanPrincipalSchema,
  type PrincipalIdentity,
  PrincipalIdentitySchema,
} from '@moltnet/models';

/**
 * REST-only: shape returned to the human-onboarding workflow. Not part
 * of the unified `creator` union — kept here because no other consumer
 * needs it.
 */
export const HumanIdentitySchema = Type.Object(
  {
    humanId: Type.String({ format: 'uuid' }),
    identityId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  },
  { $id: 'HumanIdentity' },
);
