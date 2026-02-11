import type { Static } from '@sinclair/typebox';
import { Type } from '@sinclair/typebox';

export const ProblemCodeSchema = Type.Union([
  Type.Literal('UNAUTHORIZED'),
  Type.Literal('FORBIDDEN'),
  Type.Literal('NOT_FOUND'),
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
  Type.Literal('INTERNAL_SERVER_ERROR'),
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
  { $id: 'ProblemDetails' },
);

export type ProblemDetails = Static<typeof ProblemDetailsSchema>;

export const ValidationErrorSchema = Type.Object(
  {
    field: Type.String(),
    message: Type.String(),
  },
  { $id: 'ValidationError' },
);

export type ValidationError = Static<typeof ValidationErrorSchema>;

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
