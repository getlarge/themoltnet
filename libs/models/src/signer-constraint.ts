import { type Static, Type } from 'typebox';

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

export const SIGNER_TEAM_ROLE_VALUES = ['owner', 'manager', 'member'] as const;
export type SignerTeamRole = (typeof SIGNER_TEAM_ROLE_VALUES)[number];

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
    id: Type.Union(SIGNER_TEAM_ROLE_VALUES.map((value) => Type.Literal(value))),
  }),
  Type.Object({
    type: Type.Literal(SIGNER_CONSTRAINT_TYPE.Group),
    id: Type.String({ format: 'uuid' }),
  }),
  Type.Object({
    type: Type.Literal(SIGNER_CONSTRAINT_TYPE.Site),
    id: Type.Optional(Type.String()),
  }),
  Type.Object({
    type: Type.Literal(SIGNER_CONSTRAINT_TYPE.Station),
    id: Type.Optional(Type.String()),
  }),
]);

export type SignerConstraint = Static<typeof SignerConstraintSchema>;
