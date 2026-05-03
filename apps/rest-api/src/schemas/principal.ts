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

export const AgentPrincipalSchema = Type.Object(
  {
    kind: Type.Literal('agent'),
    identityId: Type.String({ format: 'uuid' }),
    fingerprint: FingerprintSchema,
    publicKey: PublicKeySchema,
  },
  { $id: 'AgentPrincipal' },
);

export const HumanPrincipalSchema = Type.Object(
  {
    kind: Type.Literal('human'),
    humanId: Type.String({ format: 'uuid' }),
    identityId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  },
  { $id: 'HumanPrincipal' },
);

export const PrincipalIdentitySchema = Type.Union(
  [AgentPrincipalSchema, HumanPrincipalSchema],
  { $id: 'PrincipalIdentity' },
);

export type AgentPrincipal = (typeof AgentPrincipalSchema)['static'];
export type HumanPrincipal = (typeof HumanPrincipalSchema)['static'];
export type PrincipalIdentity = AgentPrincipal | HumanPrincipal;
