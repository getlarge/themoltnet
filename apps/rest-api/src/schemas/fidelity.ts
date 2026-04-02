import { Type } from '@sinclair/typebox';

import { DateTime } from './atoms.js';

// ── Fidelity Verification ─────────────────────────────────

export const VerifyRenderedPackBodySchema = Type.Object(
  {
    nonce: Type.String({
      format: 'uuid',
      description: 'Caller-generated nonce for idempotency.',
    }),
  },
  {
    additionalProperties: false,
    description: 'Trigger fidelity verification for an agent-rendered pack.',
  },
);

export const VerifyRenderedPackResponseSchema = Type.Object(
  {
    verificationId: Type.String({ format: 'uuid' }),
    nonce: Type.String({ format: 'uuid' }),
  },
  { $id: 'VerifyRenderedPackResponse' },
);

export const ClaimVerificationResponseSchema = Type.Object(
  {
    sourceEntries: Type.Array(
      Type.Object({
        title: Type.String(),
        content: Type.String(),
        contentHash: Type.String(),
      }),
    ),
    renderedContent: Type.String(),
    rubric: Type.String(),
  },
  { $id: 'ClaimVerificationResponse' },
);

export const SubmitVerificationBodySchema = Type.Object(
  {
    nonce: Type.String({ format: 'uuid' }),
    coverage: Type.Number({ minimum: 0, maximum: 1 }),
    grounding: Type.Number({ minimum: 0, maximum: 1 }),
    faithfulness: Type.Number({ minimum: 0, maximum: 1 }),
    transcript: Type.String({ minLength: 1 }),
    judgeModel: Type.String({
      minLength: 1,
      maxLength: 100,
      pattern: '^[a-z0-9._:-]+$',
    }),
    judgeProvider: Type.String({
      minLength: 1,
      maxLength: 50,
      pattern: '^[a-z0-9-]+$',
    }),
    judgeBinaryCid: Type.String({ minLength: 1, maxLength: 100 }),
  },
  {
    additionalProperties: false,
    description: 'Submit fidelity judge results.',
  },
);

export const SubmitVerificationResponseSchema = Type.Object(
  {
    attestationId: Type.String({ format: 'uuid' }),
    composite: Type.Number({ minimum: 0, maximum: 1 }),
  },
  { $id: 'SubmitVerificationResponse' },
);

export const AttestationSchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    renderedPackId: Type.String({ format: 'uuid' }),
    coverage: Type.Number({ minimum: 0, maximum: 1 }),
    grounding: Type.Number({ minimum: 0, maximum: 1 }),
    faithfulness: Type.Number({ minimum: 0, maximum: 1 }),
    composite: Type.Number({ minimum: 0, maximum: 1 }),
    judgeModel: Type.String(),
    judgeProvider: Type.String(),
    judgeBinaryCid: Type.String(),
    rubricCid: Type.Union([Type.String(), Type.Null()]),
    createdBy: Type.String({ format: 'uuid' }),
    createdAt: DateTime,
  },
  { $id: 'Attestation' },
);
