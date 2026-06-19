import type { Static } from 'typebox';
import { Type } from 'typebox';

export const ProblemCodeSchema = Type.Union([
  Type.Literal('UNAUTHORIZED'),
  Type.Literal('FORBIDDEN'),
  Type.Literal('NOT_FOUND'),
  Type.Literal('CONFLICT'),
  Type.Literal('VALIDATION_FAILED'),
  Type.Literal('INVALID_CHALLENGE'),
  Type.Literal('INVALID_SIGNATURE'),
  Type.Literal('VOUCHER_LIMIT'),
  Type.Literal('RATE_LIMIT_EXCEEDED'),
  Type.Literal('SERIALIZATION_EXHAUSTED'),
  Type.Literal('SIGNING_REQUEST_EXPIRED'),
  Type.Literal('SIGNING_REQUEST_ALREADY_COMPLETED'),
  Type.Literal('REGISTRATION_FAILED'),
  Type.Literal('UPSTREAM_ERROR'),
  Type.Literal('SERVICE_UNAVAILABLE'),
  Type.Literal('INTERNAL_SERVER_ERROR'),
  Type.Literal('TEAM_PERSONAL_IMMUTABLE'),
  Type.Literal('TEAM_NOT_ACTIVE'),
  Type.Literal('INVITE_EXPIRED'),
  Type.Literal('INVITE_EXHAUSTED'),
  Type.Literal('TEAM_LAST_OWNER'),
  Type.Literal('TEAM_ALREADY_ACTIVE'),
  Type.Literal('TEAM_NOT_FOUNDING'),
  Type.Literal('FOUNDING_ALREADY_ACCEPTED'),
  Type.Literal('DIARY_TRANSFER_PENDING'),
  Type.Literal('DIARY_TRANSFER_NOT_FOUND'),
  Type.Literal('DIARY_TRANSFER_ALREADY_RESOLVED'),
]);

export type ProblemCode = Static<typeof ProblemCodeSchema>;

export const ProblemDetailsSchema = Type.Object(
  {
    type: Type.String({ format: 'uri' }),
    title: Type.String(),
    status: Type.Integer({ minimum: 100, maximum: 599 }),
    code: ProblemCodeSchema,
    detail: Type.Optional(Type.String()),
    instance: Type.Optional(Type.String()),
  },
  // RFC 9457 §3 — problem details MAY contain extension members beyond the
  // standard fields. Routes that need structured detail (e.g. listing
  // injection-flagged entries on a 409) attach them via createProblem's
  // `extensions` arg; the error handler merges them into the body.
  { $id: 'ProblemDetails', additionalProperties: true },
);

export type ProblemDetails = Static<typeof ProblemDetailsSchema>;

export const ValidationErrorSchema = Type.Object(
  {
    field: Type.String(),
    message: Type.String(),
    /**
     * Optional machine-readable code for branch-able client handling
     * (e.g. `freeform.sourceTaskNotFound`). Free-form by convention:
     * `<scope>.<failure>` with dot-namespacing. Absent when the producer
     * didn't emit one — older code paths just send `field` + `message`.
     */
    code: Type.Optional(Type.String()),
  },
  { $id: 'ValidationError', additionalProperties: false },
);

export type ValidationError = Static<typeof ValidationErrorSchema>;

export const ConflictTargetSchema = Type.Object(
  {
    resource: Type.String(),
    id: Type.Optional(Type.String({ format: 'uuid' })),
    keys: Type.Optional(Type.Record(Type.String(), Type.String())),
  },
  { $id: 'ConflictTarget', additionalProperties: false },
);

export type ConflictTarget = Static<typeof ConflictTargetSchema>;

export const ConflictErrorSchema = Type.Object(
  {
    constraint: Type.Optional(Type.String()),
    target: Type.Optional(ConflictTargetSchema),
  },
  { $id: 'ConflictError', additionalProperties: false },
);

export type ConflictError = Static<typeof ConflictErrorSchema>;

export const ConflictProblemDetailsSchema = Type.Intersect(
  [
    ProblemDetailsSchema,
    Type.Object({
      conflict: ConflictErrorSchema,
    }),
  ],
  { $id: 'ConflictProblemDetails' },
);

export type ConflictProblemDetails = Static<
  typeof ConflictProblemDetailsSchema
>;

export const ValidationProblemDetailsSchema = Type.Intersect(
  [
    ProblemDetailsSchema,
    Type.Object({
      errors: Type.Array(ValidationErrorSchema),
    }),
  ],
  { $id: 'ValidationProblemDetails' },
);

export type ValidationProblemDetails = Static<
  typeof ValidationProblemDetailsSchema
>;
