import { type Static, Type } from 'typebox';

import { TeamRoleSchema } from './schemas.js';

export const SIGNER_CONSTRAINT_TYPE = {
  Human: 'human',
  TeamRole: 'team-role',
  Group: 'group',
  Site: 'site',
  Station: 'station',
} as const;

export type SignerConstraintType =
  (typeof SIGNER_CONSTRAINT_TYPE)[keyof typeof SIGNER_CONSTRAINT_TYPE];

export const SIGNER_CONSTRAINT_TYPE_VALUES = [
  SIGNER_CONSTRAINT_TYPE.Human,
  SIGNER_CONSTRAINT_TYPE.TeamRole,
  SIGNER_CONSTRAINT_TYPE.Group,
  SIGNER_CONSTRAINT_TYPE.Site,
  SIGNER_CONSTRAINT_TYPE.Station,
] as const satisfies readonly SignerConstraintType[];

export type SignerTeamRole = Static<typeof TeamRoleSchema>;

export const SignerConstraintTypeSchema = Type.Union(
  SIGNER_CONSTRAINT_TYPE_VALUES.map((value) => Type.Literal(value)),
);

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
