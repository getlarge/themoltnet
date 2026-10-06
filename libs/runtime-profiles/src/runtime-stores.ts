import { type Static, Type } from 'typebox';

const uuid = Type.String({ format: 'uuid' });
const integer = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const strict = { additionalProperties: false };

export const RuntimeStoreAuthority = Type.Object(
  {
    taskId: uuid,
    attemptN: Type.Integer({ minimum: 1 }),
    leaseId: uuid,
    executorFingerprint: Type.String({ minLength: 1 }),
  },
  { $id: 'RuntimeStoreAuthority', ...strict },
);
export type RuntimeStoreAuthority = Static<typeof RuntimeStoreAuthority>;
export const RuntimeStoreWriter = Type.Object(
  {
    ...RuntimeStoreAuthority.properties,
    writerToken: uuid,
  },
  { $id: 'RuntimeStoreWriter', ...strict },
);
export type RuntimeStoreWriter = Static<typeof RuntimeStoreWriter>;
export const RuntimeStoreHandle = Type.Object(
  {
    storeId: uuid,
    format: Type.Literal('pi-durable.v1'),
    headSeq: integer,
    writerToken: uuid,
    writerExpiresAt: Type.String({ format: 'date-time' }),
  },
  { $id: 'RuntimeStoreHandle', ...strict },
);
export type RuntimeStoreHandle = Static<typeof RuntimeStoreHandle>;
export const RuntimeStoreParams = Type.Object({ storeId: uuid }, strict);
export const AppendRuntimeStoreCommit = Type.Object(
  {
    ...RuntimeStoreWriter.properties,
    commitId: uuid,
    expectedSeq: integer,
    writes: Type.Array(Type.Record(Type.String(), Type.Unknown())),
  },
  { $id: 'AppendRuntimeStoreCommit', ...strict },
);
export type AppendRuntimeStoreCommit = Static<typeof AppendRuntimeStoreCommit>;
export const RuntimeStoreCommit = Type.Object(
  {
    seq: integer,
    commitId: uuid,
    sha256: Type.String({ pattern: '^[0-9a-f]{64}$' }),
    writes: Type.Array(Type.Record(Type.String(), Type.Unknown())),
  },
  { $id: 'RuntimeStoreCommit', ...strict },
);
export type RuntimeStoreCommit = Static<typeof RuntimeStoreCommit>;
export const RuntimeStoreCommitPage = Type.Object(
  {
    items: Type.Array(RuntimeStoreCommit),
    headSeq: integer,
  },
  { $id: 'RuntimeStoreCommitPage', ...strict },
);
export const RuntimeStoreCommitReceipt = Type.Object({ seq: integer }, strict);
export const RuntimeStoreIdAllocation = Type.Object({ id: integer }, strict);
export const RuntimeStoreReadQuery = Type.Object(
  {
    afterSeq: Type.Optional(integer),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  },
  strict,
);

export const RuntimeStoreAttemptQuery = Type.Object(
  { taskId: uuid, attemptN: Type.Integer({ minimum: 1 }) },
  strict,
);
export const RuntimeStoreInfo = Type.Object(
  { storeId: uuid, format: Type.Literal('pi-durable.v1'), headSeq: integer },
  { $id: 'RuntimeStoreInfo', ...strict },
);
export const RuntimeStoreAttemptResponse = Type.Union([
  RuntimeStoreInfo,
  Type.Null(),
]);
