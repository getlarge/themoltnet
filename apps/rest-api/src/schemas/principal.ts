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

// Variants declared as Type.Unsafe (raw JSON Schema) so we can attach
// `additionalProperties: true` and the discriminator metadata that
// fast-json-stringify needs to keep variant-specific fields on
// serialization. TypeBox's Type.Composite + Type.Union path strips
// fields when fjs can't decide which variant applies.

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

// Use Type.Union with both variants inlined (no $ref) so fast-json-stringify
// can build a complete oneOf schema without resolving external refs at
// serialization time. TypeBox's Type.Union produces anyOf in JSON Schema —
// fjs handles anyOf by trying each variant and picking the first match,
// which works as long as the variants are NON-overlapping (the `kind`
// discriminator literal guarantees that).
export const PrincipalIdentitySchema = Type.Union(
  [
    Type.Object(
      {
        kind: Type.Literal('agent'),
        identityId: Type.String({ format: 'uuid' }),
        fingerprint: FingerprintSchema,
        publicKey: PublicKeySchema,
      },
      {},
    ),
    Type.Object(
      {
        kind: Type.Literal('human'),
        humanId: Type.String({ format: 'uuid' }),
        identityId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
      },
      {},
    ),
  ],
  { $id: 'PrincipalIdentity' },
);

export type AgentPrincipal = (typeof AgentPrincipalSchema)['static'];
export type HumanPrincipal = (typeof HumanPrincipalSchema)['static'];
export type PrincipalIdentity = AgentPrincipal | HumanPrincipal;
