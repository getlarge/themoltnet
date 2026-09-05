import { type Static, Type } from 'typebox';

import { FingerprintSchema, PublicKeySchema, UuidSchema } from './schemas.js';

/**
 * Discriminated-union schema for the creator of any owned MoltNet
 * resource (diary, diary entry, context pack, rendered pack, team).
 *
 * Lives in `@moltnet/models` so the REST API, MCP server, provenance
 * graph models, and any future consumer can import a single source of
 * truth instead of duplicating the shape.
 *
 * Both branches set `additionalProperties: false` so a malformed
 * payload that mixes agent + human fields cannot validate as either
 * variant — the discriminator stays sharp.
 */
export const AgentPrincipalSchema = Type.Object(
  {
    kind: Type.Literal('agent'),
    /**
     * Internal MoltNet agent ID — stable for the life of the agent and the
     * value every agent foreign key and Keto tuple refers to.
     */
    agentId: UuidSchema,
    /**
     * Ory Kratos identity bound to this agent, or null when it has none.
     *
     * Null is not a registration race (agents are created synchronously, with
     * no webhook): it means the Kratos identity is gone or not yet
     * reprovisioned. Keeping this nullable is what stops an identity loss from
     * turning every read of that agent's resources into a serialization error.
     */
    identityId: Type.Union([UuidSchema, Type.Null()]),
    fingerprint: FingerprintSchema,
    publicKey: PublicKeySchema,
  },
  {
    $id: 'AgentPrincipal',
    additionalProperties: false,
  },
);

export const HumanPrincipalSchema = Type.Object(
  {
    kind: Type.Literal('human'),
    humanId: UuidSchema,
    // Null until the human completes Kratos onboarding (first login).
    identityId: Type.Union([UuidSchema, Type.Null()]),
  },
  {
    $id: 'HumanPrincipal',
    additionalProperties: false,
  },
);

const AgentPrincipalInlineSchema = Type.Object(
  {
    kind: Type.Literal('agent'),
    // Keep in lockstep with AgentPrincipalSchema above.
    agentId: UuidSchema,
    identityId: Type.Union([UuidSchema, Type.Null()]),
    fingerprint: FingerprintSchema,
    publicKey: PublicKeySchema,
  },
  { additionalProperties: false },
);

const HumanPrincipalInlineSchema = Type.Object(
  {
    kind: Type.Literal('human'),
    humanId: UuidSchema,
    identityId: Type.Union([UuidSchema, Type.Null()]),
  },
  { additionalProperties: false },
);

const principalUnionVariants = [
  AgentPrincipalInlineSchema,
  HumanPrincipalInlineSchema,
] satisfies [
  typeof AgentPrincipalInlineSchema,
  typeof HumanPrincipalInlineSchema,
];

/**
 * Inlined union — see the long-form rationale in
 * `apps/rest-api/src/schemas/principal.ts` for why we cannot $ref the
 * named variants from inside the union when the parent has its own
 * `$id` (Ajv 8 + fast-json-stringify both refuse to resolve the
 * cross-schema references at compile time, which surfaces as a 500 on
 * every response embedding `creator`).
 *
 * The named `AgentPrincipalSchema` / `HumanPrincipalSchema` above are
 * still exported so generated clients (Go SDK, openapi-ts) get proper
 * sum types; the inline copies keep fjs / Ajv happy at runtime.
 */
export const PrincipalIdentitySchema = Type.Union(principalUnionVariants, {
  $id: 'PrincipalIdentity',
  discriminator: { propertyName: 'kind' },
});

/**
 * `$id`-less twin of `PrincipalIdentitySchema`. Required anywhere the
 * schema is **embedded** inline into another schema (MCP `outputSchema`
 * — every tool that returns a creator-bearing object embeds its own
 * copy; provenance-graph node `meta.creator`, etc.). Ajv 8 throws
 * `reference "PrincipalIdentity" resolves to more than one schema` if
 * the same `$id` appears twice in the same compilation pass, which is
 * exactly what happens when the MCP server lists tools and Ajv
 * traverses every advertised `outputSchema`.
 *
 * Structurally identical to `PrincipalIdentitySchema` (they share the
 * variants array); change one, change both.
 */
export const PrincipalIdentitySchemaInline = Type.Union(
  principalUnionVariants,
  { discriminator: { propertyName: 'kind' } },
);

export type AgentPrincipal = Static<typeof AgentPrincipalSchema>;
export type HumanPrincipal = Static<typeof HumanPrincipalSchema>;
export type PrincipalIdentity = AgentPrincipal | HumanPrincipal;
