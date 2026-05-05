import { Type } from '@sinclair/typebox';

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
    identityId: UuidSchema,
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
export const PrincipalIdentitySchema = Type.Union(
  [
    Type.Object(
      {
        kind: Type.Literal('agent'),
        identityId: UuidSchema,
        fingerprint: FingerprintSchema,
        publicKey: PublicKeySchema,
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        kind: Type.Literal('human'),
        humanId: UuidSchema,
        identityId: Type.Union([UuidSchema, Type.Null()]),
      },
      { additionalProperties: false },
    ),
  ],
  {
    $id: 'PrincipalIdentity',
    discriminator: { propertyName: 'kind' },
  },
);

export type AgentPrincipal = (typeof AgentPrincipalSchema)['static'];
export type HumanPrincipal = (typeof HumanPrincipalSchema)['static'];
export type PrincipalIdentity = AgentPrincipal | HumanPrincipal;
