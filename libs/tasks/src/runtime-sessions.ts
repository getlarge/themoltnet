import { type Static, Type } from 'typebox';

export const RuntimeSessionKind = Type.Union([
  Type.Literal('root'),
  Type.Literal('extend'),
  Type.Literal('fork'),
]);
export type RuntimeSessionKind = Static<typeof RuntimeSessionKind>;

export const RuntimeSessionCheckpointKind = Type.Union([
  Type.Literal('attempt_final'),
]);
export type RuntimeSessionCheckpointKind = Static<
  typeof RuntimeSessionCheckpointKind
>;

export const RuntimeSession = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    teamId: Type.String({ format: 'uuid' }),
    taskId: Type.String({ format: 'uuid' }),
    attemptN: Type.Integer({ minimum: 1 }),
    sourceSlotId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    sourceRuntimeProfileId: Type.Union([
      Type.String({ format: 'uuid' }),
      Type.Null(),
    ]),
    sessionKind: RuntimeSessionKind,
    parentSessionId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    objectKey: Type.String({ minLength: 1 }),
    contentType: Type.String({ minLength: 1, maxLength: 200 }),
    contentEncoding: Type.Union([
      Type.String({ minLength: 1, maxLength: 100 }),
      Type.Null(),
    ]),
    sizeBytes: Type.Integer({ minimum: 0 }),
    sha256: Type.String({ minLength: 64, maxLength: 64 }),
    storageClass: Type.String({ minLength: 1, maxLength: 100 }),
    checkpointKind: RuntimeSessionCheckpointKind,
    uploadedAt: Type.String({ format: 'date-time' }),
  },
  { $id: 'RuntimeSession' },
);
export type RuntimeSession = Static<typeof RuntimeSession>;

export const UploadRuntimeSessionBody = Type.Object(
  {
    sourceSlotId: Type.Optional(Type.String({ format: 'uuid' })),
    sourceRuntimeProfileId: Type.Optional(Type.String({ format: 'uuid' })),
    sessionKind: RuntimeSessionKind,
    parentSessionId: Type.Optional(Type.String({ format: 'uuid' })),
    contentBase64: Type.String({ minLength: 1 }),
  },
  { $id: 'UploadRuntimeSessionBody', additionalProperties: false },
);
export type UploadRuntimeSessionBody = Static<typeof UploadRuntimeSessionBody>;

export const RuntimeSessionAttemptParams = Type.Object(
  {
    taskId: Type.String({ format: 'uuid' }),
    attemptN: Type.Integer({ minimum: 1 }),
  },
  {
    $id: 'RuntimeSessionAttemptParams',
    additionalProperties: false,
  },
);
export type RuntimeSessionAttemptParams = Static<
  typeof RuntimeSessionAttemptParams
>;

export const DownloadRuntimeSessionResponse = Type.Object(
  {
    session: RuntimeSession,
    contentBase64: Type.String(),
  },
  { $id: 'DownloadRuntimeSessionResponse' },
);
export type DownloadRuntimeSessionResponse = Static<
  typeof DownloadRuntimeSessionResponse
>;

export const runtimeSessionSchemas = [
  RuntimeSession,
  UploadRuntimeSessionBody,
  RuntimeSessionAttemptParams,
  DownloadRuntimeSessionResponse,
];
