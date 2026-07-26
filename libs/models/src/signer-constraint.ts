import { type Static, Type } from 'typebox';

import { TeamRoleSchema } from './schemas.js';

export const SIGNER_CONSTRAINT_TYPE = {
  Human: 'human',
  TeamRole: 'team-role',
  Group: 'group',
} as const;

export const SignerConstraintSchema = Type.Union([
  Type.Object({
    type: Type.Literal(SIGNER_CONSTRAINT_TYPE.Human),
    id: Type.String({ format: 'uuid' }),
  }),
  Type.Object({
    type: Type.Literal(SIGNER_CONSTRAINT_TYPE.TeamRole),
    id: TeamRoleSchema,
  }),
  Type.Object({
    type: Type.Literal(SIGNER_CONSTRAINT_TYPE.Group),
    id: Type.String({ format: 'uuid' }),
  }),
]);

export type SignerConstraint = Static<typeof SignerConstraintSchema>;
