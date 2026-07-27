import { type Static, type TSchema, Type } from 'typebox';

import {
  PreviewSignArkgSeedPublicKeySchema,
  PreviewSignBase64UrlSchema,
  PreviewSignChallengeOperationSchema,
  PreviewSignChallengeSchema,
  PreviewSignChallengeValueSchema,
  PreviewSignEcdhEsHkdf256PublicKeySchema,
  PreviewSignEs256PublicKeySchema,
  PreviewSignPublicMaterialSchema,
  PreviewSignReceiptSchema,
  PreviewSignReceiptValueSchema,
  previewSignSchemaContext,
  PreviewSignSha256Base64UrlSchema,
} from './preview-sign.js';

function schemaRef(schema: TSchema) {
  const id = schemaId(schema);
  return Type.Ref(id);
}

function schemaId(schema: TSchema): string {
  const id = (schema as { $id?: unknown }).$id;
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('Signer protocol schemas must have an identifier');
  }
  return id;
}

export const SignerBase64UrlSchema = PreviewSignBase64UrlSchema;
export const SignerSha256Base64UrlSchema = PreviewSignSha256Base64UrlSchema;

export const SignerUuidSchema = Type.String({
  $id: 'SignerUuid',
  pattern:
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
});

export const SignerOperationSchema = Type.Union(
  [
    Type.Literal('credential-enrollment'),
    Type.Literal('credential-registration'),
    Type.Literal('signing-request'),
  ],
  { $id: 'SignerOperation' },
);

export const SignerChallengeOperationSchema =
  PreviewSignChallengeOperationSchema;
export const SignerEs256PublicKeySchema = PreviewSignEs256PublicKeySchema;
export const SignerEcdhEsHkdf256PublicKeySchema =
  PreviewSignEcdhEsHkdf256PublicKeySchema;
export const SignerArkgSeedPublicKeySchema = PreviewSignArkgSeedPublicKeySchema;
export const SignerPreviewSignPublicMaterialSchema =
  PreviewSignPublicMaterialSchema;
export const SignerPreviewSignChallengeSchema = PreviewSignChallengeSchema;
export const SignerPreviewSignChallengeValueSchema =
  PreviewSignChallengeValueSchema;

export const SignerSessionSchema = Type.Object(
  {
    version: Type.Literal(1),
    token: Type.Unsafe<Static<typeof SignerBase64UrlSchema>>(
      schemaRef(SignerBase64UrlSchema),
    ),
    expiresAt: Type.String(),
  },
  { $id: 'SignerSession', additionalProperties: false },
);

export const SignerEnrollmentCeremonyRequestSchema = Type.Object(
  {
    version: Type.Literal(1),
    operation: Type.Literal('credential-enrollment'),
    label: Type.String({ minLength: 1, maxLength: 255 }),
    teamId: Type.Unsafe<Static<typeof SignerUuidSchema>>(
      schemaRef(SignerUuidSchema),
    ),
  },
  { $id: 'SignerEnrollmentCeremonyRequest', additionalProperties: false },
);

export const SignerChallengeCeremonyRequestSchema = Type.Object(
  {
    version: Type.Literal(1),
    operation: Type.Unsafe<Static<typeof SignerChallengeOperationSchema>>(
      schemaRef(SignerChallengeOperationSchema),
    ),
    resourceId: Type.Unsafe<Static<typeof SignerUuidSchema>>(
      schemaRef(SignerUuidSchema),
    ),
    challenge: Type.Unsafe<
      Static<typeof SignerPreviewSignChallengeValueSchema>
    >(schemaRef(SignerPreviewSignChallengeValueSchema)),
  },
  { $id: 'SignerChallengeCeremonyRequest', additionalProperties: false },
);

export const SignerCeremonyRequestSchema = Type.Union(
  [
    Type.Unsafe<Static<typeof SignerEnrollmentCeremonyRequestSchema>>(
      schemaRef(SignerEnrollmentCeremonyRequestSchema),
    ),
    Type.Unsafe<Static<typeof SignerChallengeCeremonyRequestSchema>>(
      schemaRef(SignerChallengeCeremonyRequestSchema),
    ),
  ],
  { $id: 'SignerCeremonyRequest' },
);

export const SignerCeremonySchema = Type.Object(
  {
    version: Type.Literal(1),
    id: Type.Unsafe<Static<typeof SignerBase64UrlSchema>>(
      schemaRef(SignerBase64UrlSchema),
    ),
    operation: Type.Unsafe<Static<typeof SignerOperationSchema>>(
      schemaRef(SignerOperationSchema),
    ),
    approvalUrl: Type.String(),
    expiresAt: Type.String(),
  },
  { $id: 'SignerCeremony', additionalProperties: false },
);

export const SignerPendingResultSchema = Type.Object(
  {
    version: Type.Literal(1),
    status: Type.Literal('pending'),
    operation: Type.Unsafe<Static<typeof SignerOperationSchema>>(
      schemaRef(SignerOperationSchema),
    ),
  },
  { $id: 'SignerPendingResult', additionalProperties: false },
);

export const SignerEnrollmentResultSchema = Type.Object(
  {
    version: Type.Literal(1),
    status: Type.Literal('completed'),
    operation: Type.Literal('credential-enrollment'),
    publicMaterial: Type.Unsafe<
      Static<typeof SignerPreviewSignPublicMaterialSchema>
    >(schemaRef(SignerPreviewSignPublicMaterialSchema)),
  },
  { $id: 'SignerEnrollmentResult', additionalProperties: false },
);

export const SignerReceiptValueSchema = PreviewSignReceiptSchema;
export const SignerReceiptSchema = PreviewSignReceiptValueSchema;

export const SignerSignatureResultSchema = Type.Object(
  {
    version: Type.Literal(1),
    status: Type.Literal('completed'),
    operation: Type.Unsafe<Static<typeof SignerChallengeOperationSchema>>(
      schemaRef(SignerChallengeOperationSchema),
    ),
    receipt: Type.Unsafe<Static<typeof SignerReceiptSchema>>(
      schemaRef(SignerReceiptSchema),
    ),
  },
  { $id: 'SignerSignatureResult', additionalProperties: false },
);

export const SignerFailedResultSchema = Type.Object(
  {
    version: Type.Literal(1),
    status: Type.Literal('failed'),
    operation: Type.Unsafe<Static<typeof SignerOperationSchema>>(
      schemaRef(SignerOperationSchema),
    ),
    code: Type.String(),
    message: Type.String(),
  },
  { $id: 'SignerFailedResult', additionalProperties: false },
);

export const SignerCeremonyResultSchema = Type.Union(
  [
    Type.Unsafe<Static<typeof SignerPendingResultSchema>>(
      schemaRef(SignerPendingResultSchema),
    ),
    Type.Unsafe<Static<typeof SignerEnrollmentResultSchema>>(
      schemaRef(SignerEnrollmentResultSchema),
    ),
    Type.Unsafe<Static<typeof SignerSignatureResultSchema>>(
      schemaRef(SignerSignatureResultSchema),
    ),
    Type.Unsafe<Static<typeof SignerFailedResultSchema>>(
      schemaRef(SignerFailedResultSchema),
    ),
  ],
  { $id: 'SignerCeremonyResult' },
);

/** TypeBox reference context in dependency order for standalone validators. */
export const signerProtocolSchemaContext = {
  ...previewSignSchemaContext,
  [schemaId(SignerUuidSchema)]: SignerUuidSchema,
  [schemaId(SignerOperationSchema)]: SignerOperationSchema,
  [schemaId(SignerSessionSchema)]: SignerSessionSchema,
  [schemaId(SignerEnrollmentCeremonyRequestSchema)]:
    SignerEnrollmentCeremonyRequestSchema,
  [schemaId(SignerChallengeCeremonyRequestSchema)]:
    SignerChallengeCeremonyRequestSchema,
  [schemaId(SignerCeremonyRequestSchema)]: SignerCeremonyRequestSchema,
  [schemaId(SignerCeremonySchema)]: SignerCeremonySchema,
  [schemaId(SignerPendingResultSchema)]: SignerPendingResultSchema,
  [schemaId(SignerEnrollmentResultSchema)]: SignerEnrollmentResultSchema,
  [schemaId(SignerSignatureResultSchema)]: SignerSignatureResultSchema,
  [schemaId(SignerFailedResultSchema)]: SignerFailedResultSchema,
  [schemaId(SignerCeremonyResultSchema)]: SignerCeremonyResultSchema,
} as const;

export type SignerPreviewSignPublicMaterial = Static<
  typeof SignerPreviewSignPublicMaterialSchema
>;
export type SignerPreviewSignChallengeValue = Static<
  typeof SignerPreviewSignChallengeValueSchema
>;
export type SignerSession = Static<typeof SignerSessionSchema>;
export type SignerCeremonyRequest = Static<typeof SignerCeremonyRequestSchema>;
export type SignerCeremony = Static<typeof SignerCeremonySchema>;
export type SignerCeremonyResult = Static<typeof SignerCeremonyResultSchema>;
