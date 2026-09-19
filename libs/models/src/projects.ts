import { type Static, Type } from 'typebox';

export const ProjectResponseSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  teamId: Type.String({ format: 'uuid' }),
  name: Type.String(),
  description: Type.Union([Type.String(), Type.Null()]),
  defaultDiaryId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  archived: Type.Boolean(),
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
});
export const CreateProjectSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 255, pattern: '\\S' }),
    description: Type.Optional(
      Type.Union([Type.String({ maxLength: 10000 }), Type.Null()]),
    ),
    defaultDiaryId: Type.Optional(
      Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    ),
  },
  { additionalProperties: false },
);
export const UpdateProjectSchema = Type.Object(
  {
    ...Type.Partial(CreateProjectSchema).properties,
    archived: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false, minProperties: 1 },
);
export type ProjectResponse = Static<typeof ProjectResponseSchema>;
