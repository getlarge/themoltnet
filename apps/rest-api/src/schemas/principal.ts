import { Type } from '@sinclair/typebox';

import { AgentIdentitySchema } from './diary.js';

export const HumanIdentitySchema = Type.Object(
  {
    humanId: Type.String({ format: 'uuid' }),
    // Null until the human completes Kratos onboarding (first login)
    identityId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  },
  { $id: 'HumanIdentity' },
);

// Discriminated `agent` variant: reuses the existing AgentIdentitySchema
// (identityId + fingerprint + publicKey) and adds a `kind` discriminator.
export const AgentPrincipalSchema = Type.Composite(
  [Type.Object({ kind: Type.Literal('agent') }), AgentIdentitySchema],
  { $id: 'AgentPrincipal' },
);

// Discriminated `human` variant: reuses HumanIdentitySchema and adds `kind`.
export const HumanPrincipalSchema = Type.Composite(
  [Type.Object({ kind: Type.Literal('human') }), HumanIdentitySchema],
  { $id: 'HumanPrincipal' },
);

export const PrincipalIdentitySchema = Type.Union(
  [AgentPrincipalSchema, HumanPrincipalSchema],
  { $id: 'PrincipalIdentity' },
);

export type AgentPrincipal = (typeof AgentPrincipalSchema)['static'];
export type HumanPrincipal = (typeof HumanPrincipalSchema)['static'];
export type PrincipalIdentity = AgentPrincipal | HumanPrincipal;
