import { FingerprintSchema, PublicKeySchema } from '@moltnet/models';
import { Type } from '@sinclair/typebox';

export const HumanIdentitySchema = Type.Object(
  {
    humanId: Type.String({ format: 'uuid' }),
    // Null until the human completes Kratos onboarding (first login)
    identityId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  },
  { $id: 'HumanIdentity' },
);

/**
 * Discriminated-union variant for an agent principal.
 *
 * Registered as a named schema (`$id: 'AgentPrincipal'`) and exported so
 * generated clients (Go SDK, openapi-ts) get a proper named type instead
 * of an inline anonymous shape. `additionalProperties: false` is
 * intentional — the union variants are exhaustively typed and any extra
 * field on the wire indicates either a schema drift bug or a forward-
 * compatibility break that callers MUST opt into.
 */
export const AgentPrincipalSchema = Type.Object(
  {
    kind: Type.Literal('agent'),
    identityId: Type.String({ format: 'uuid' }),
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
    humanId: Type.String({ format: 'uuid' }),
    identityId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  },
  {
    $id: 'HumanPrincipal',
    additionalProperties: false,
  },
);

/**
 * Union of the principal variants — INLINED, not $ref'd, on purpose.
 *
 * We tried `Type.Union([Type.Ref(AgentPrincipalSchema),
 * Type.Ref(HumanPrincipalSchema)])` (commit history retains the attempt).
 * Both fastify-fast-json-stringify (response serializer) and Ajv 8 (used
 * by @fastify/swagger to compile the spec) refuse to resolve cross-schema
 * $refs from inside an anyOf when the parent schema has its OWN `$id`:
 * Ajv throws `MissingRefError: can't resolve reference AgentPrincipal
 * from id PrincipalIdentity`, which surfaces as a 500 on every response
 * that embeds `creator: PrincipalIdentitySchema`. That is true even when
 * AgentPrincipalSchema / HumanPrincipalSchema are registered via
 * `app.addSchema(...)` BEFORE this schema — the variant schemas live in
 * a different `$id` scope than the union, and Ajv's reference resolver
 * does not bridge across `$id` boundaries during validator compilation.
 *
 * So:
 * - The variants are kept as named, $id-bearing schemas
 *   (`AgentPrincipalSchema`, `HumanPrincipalSchema`) so generated Go /
 *   TypeScript clients get sum types.
 * - The union INLINES the variant shapes here so fjs and Ajv have a
 *   single self-contained schema to compile. The shapes are duplicated
 *   verbatim from the named schemas above; if you change one, change
 *   both. The schema parity test in `__tests__/schemas/principal.test.ts`
 *   guards that the inline copies stay structurally identical to the
 *   named variants.
 * - The discriminator metadata is OpenAPI 3.x only; fjs ignores it but
 *   it unblocks ogen / openapi-ts to emit a tagged-union type.
 *
 * `additionalProperties: false` on each inline variant matches the
 * named variants and prevents the union from silently accepting/emitting
 * fields that aren't on the contract.
 */
export const PrincipalIdentitySchema = Type.Union(
  [
    Type.Object(
      {
        kind: Type.Literal('agent'),
        identityId: Type.String({ format: 'uuid' }),
        fingerprint: FingerprintSchema,
        publicKey: PublicKeySchema,
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        kind: Type.Literal('human'),
        humanId: Type.String({ format: 'uuid' }),
        identityId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
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
