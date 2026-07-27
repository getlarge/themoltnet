import { type Static, type TSchema, Type } from 'typebox';

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

export const SignerBase64UrlSchema = Type.String({
  $id: 'SignerBase64Url',
  minLength: 1,
  maxLength: 5462,
  pattern: '^[A-Za-z0-9_-]+$',
});

export const SignerSha256Base64UrlSchema = Type.String({
  $id: 'SignerSha256Base64Url',
  minLength: 43,
  maxLength: 43,
  pattern: '^[A-Za-z0-9_-]+$',
});

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

export const SignerChallengeOperationSchema = Type.Union(
  [Type.Literal('credential-registration'), Type.Literal('signing-request')],
  { $id: 'SignerChallengeOperation' },
);

export const SignerEs256PublicKeySchema = Type.Object(
  {
    kty: Type.Literal(2),
    algorithm: Type.Literal(-7),
    curve: Type.Literal(1),
    x: Type.Unsafe<Static<typeof SignerSha256Base64UrlSchema>>(
      schemaRef(SignerSha256Base64UrlSchema),
    ),
    y: Type.Unsafe<Static<typeof SignerSha256Base64UrlSchema>>(
      schemaRef(SignerSha256Base64UrlSchema),
    ),
  },
  { $id: 'SignerEs256PublicKey', additionalProperties: false },
);

export const SignerEcdhEsHkdf256PublicKeySchema = Type.Object(
  {
    kty: Type.Literal(2),
    algorithm: Type.Literal(-25),
    curve: Type.Literal(1),
    x: Type.Unsafe<Static<typeof SignerSha256Base64UrlSchema>>(
      schemaRef(SignerSha256Base64UrlSchema),
    ),
    y: Type.Unsafe<Static<typeof SignerSha256Base64UrlSchema>>(
      schemaRef(SignerSha256Base64UrlSchema),
    ),
  },
  { $id: 'SignerEcdhEsHkdf256PublicKey', additionalProperties: false },
);

export const SignerArkgSeedPublicKeySchema = Type.Object(
  {
    kty: Type.Literal(-65537),
    algorithm: Type.Literal(-65700),
    derivedAlgorithm: Type.Literal(-9),
    blindingKey: Type.Unsafe<Static<typeof SignerEs256PublicKeySchema>>(
      schemaRef(SignerEs256PublicKeySchema),
    ),
    kemKey: Type.Unsafe<Static<typeof SignerEcdhEsHkdf256PublicKeySchema>>(
      schemaRef(SignerEcdhEsHkdf256PublicKeySchema),
    ),
  },
  { $id: 'SignerArkgSeedPublicKey', additionalProperties: false },
);

export const SignerPreviewSignPublicMaterialSchema = Type.Object(
  {
    version: Type.Literal(1),
    outerCredentialId: Type.Unsafe<Static<typeof SignerBase64UrlSchema>>(
      schemaRef(SignerBase64UrlSchema),
    ),
    outerPublicKey: Type.Unsafe<Static<typeof SignerEs256PublicKeySchema>>(
      schemaRef(SignerEs256PublicKeySchema),
    ),
    previewKeyHandle: Type.Unsafe<Static<typeof SignerBase64UrlSchema>>(
      schemaRef(SignerBase64UrlSchema),
    ),
    seedPublicKey: Type.Unsafe<Static<typeof SignerArkgSeedPublicKeySchema>>(
      schemaRef(SignerArkgSeedPublicKeySchema),
    ),
  },
  { $id: 'SignerPreviewSignPublicMaterial', additionalProperties: false },
);

export const SignerPreviewSignChallengeSchema = Type.Object(
  {
    verificationMethod: Type.Literal('human-hardware-previewsign'),
    version: Type.Literal(1),
    envelope: Type.Unsafe<Static<typeof SignerBase64UrlSchema>>(
      schemaRef(SignerBase64UrlSchema),
    ),
    digest: Type.Unsafe<Static<typeof SignerSha256Base64UrlSchema>>(
      schemaRef(SignerSha256Base64UrlSchema),
    ),
    additionalArguments: Type.Unsafe<Static<typeof SignerBase64UrlSchema>>(
      schemaRef(SignerBase64UrlSchema),
    ),
    outerCredentialId: Type.Unsafe<Static<typeof SignerBase64UrlSchema>>(
      schemaRef(SignerBase64UrlSchema),
    ),
    outerPublicKey: Type.Unsafe<Static<typeof SignerEs256PublicKeySchema>>(
      schemaRef(SignerEs256PublicKeySchema),
    ),
    previewKeyHandle: Type.Unsafe<Static<typeof SignerBase64UrlSchema>>(
      schemaRef(SignerBase64UrlSchema),
    ),
  },
  { $id: 'SignerPreviewSignChallenge', additionalProperties: false },
);

export const SignerPreviewSignChallengeValueSchema = Type.Object(
  {
    verificationMethod: Type.Literal('human-hardware-previewsign'),
    value: Type.Unsafe<Static<typeof SignerPreviewSignChallengeSchema>>(
      schemaRef(SignerPreviewSignChallengeSchema),
    ),
  },
  { $id: 'SignerPreviewSignChallengeValue', additionalProperties: false },
);

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

export const SignerReceiptValueSchema = Type.Object(
  {
    version: Type.Literal(1),
    signature: Type.Unsafe<Static<typeof SignerBase64UrlSchema>>(
      schemaRef(SignerBase64UrlSchema),
    ),
  },
  { $id: 'SignerReceiptValue', additionalProperties: false },
);

export const SignerReceiptSchema = Type.Object(
  {
    verificationMethod: Type.Literal('human-hardware-previewsign'),
    value: Type.Unsafe<Static<typeof SignerReceiptValueSchema>>(
      schemaRef(SignerReceiptValueSchema),
    ),
  },
  { $id: 'SignerReceipt', additionalProperties: false },
);

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
  [schemaId(SignerBase64UrlSchema)]: SignerBase64UrlSchema,
  [schemaId(SignerSha256Base64UrlSchema)]: SignerSha256Base64UrlSchema,
  [schemaId(SignerUuidSchema)]: SignerUuidSchema,
  [schemaId(SignerOperationSchema)]: SignerOperationSchema,
  [schemaId(SignerChallengeOperationSchema)]: SignerChallengeOperationSchema,
  [schemaId(SignerEs256PublicKeySchema)]: SignerEs256PublicKeySchema,
  [schemaId(SignerEcdhEsHkdf256PublicKeySchema)]:
    SignerEcdhEsHkdf256PublicKeySchema,
  [schemaId(SignerArkgSeedPublicKeySchema)]: SignerArkgSeedPublicKeySchema,
  [schemaId(SignerPreviewSignPublicMaterialSchema)]:
    SignerPreviewSignPublicMaterialSchema,
  [schemaId(SignerPreviewSignChallengeSchema)]:
    SignerPreviewSignChallengeSchema,
  [schemaId(SignerPreviewSignChallengeValueSchema)]:
    SignerPreviewSignChallengeValueSchema,
  [schemaId(SignerSessionSchema)]: SignerSessionSchema,
  [schemaId(SignerEnrollmentCeremonyRequestSchema)]:
    SignerEnrollmentCeremonyRequestSchema,
  [schemaId(SignerChallengeCeremonyRequestSchema)]:
    SignerChallengeCeremonyRequestSchema,
  [schemaId(SignerCeremonyRequestSchema)]: SignerCeremonyRequestSchema,
  [schemaId(SignerCeremonySchema)]: SignerCeremonySchema,
  [schemaId(SignerPendingResultSchema)]: SignerPendingResultSchema,
  [schemaId(SignerEnrollmentResultSchema)]: SignerEnrollmentResultSchema,
  [schemaId(SignerReceiptValueSchema)]: SignerReceiptValueSchema,
  [schemaId(SignerReceiptSchema)]: SignerReceiptSchema,
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
