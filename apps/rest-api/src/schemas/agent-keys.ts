import { UuidSchema } from '@moltnet/models';
import { Type } from 'typebox';

export const AgentKeyStatusSchema = Type.Union(
  [Type.Literal('active'), Type.Literal('revoked'), Type.Literal('expired')],
  { $id: 'AgentKeyStatus' },
);

export const AgentKeyRevocationReasonSchema = Type.Union(
  [
    Type.Literal('key_compromise'),
    Type.Literal('affiliation_changed'),
    Type.Literal('superseded'),
    Type.Literal('privilege_withdrawn'),
  ],
  { $id: 'AgentKeyRevocationReason' },
);

export const AgentKeySchema = Type.Object(
  {
    id: Type.String(),
    agentId: UuidSchema,
    teamId: UuidSchema,
    name: Type.String(),
    status: AgentKeyStatusSchema,
    createdAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    expiresAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    lastUsedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    updatedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    revocationReason: Type.Union([AgentKeyRevocationReasonSchema, Type.Null()]),
    revocationDescription: Type.Union([Type.String(), Type.Null()]),
  },
  { $id: 'AgentKey' },
);

export const AgentKeyWithSecretSchema = Type.Object(
  {
    key: AgentKeySchema,
    secret: Type.String(),
  },
  { $id: 'AgentKeyWithSecret' },
);

export const AgentKeyListSchema = Type.Object(
  {
    items: Type.Array(AgentKeySchema),
    nextPageToken: Type.Union([Type.String(), Type.Null()]),
  },
  { $id: 'AgentKeyList' },
);

export const CreateAgentKeyBodySchema = Type.Object(
  {
    agentId: UuidSchema,
    name: Type.String({ minLength: 1, maxLength: 128 }),
    ttlDays: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 90, default: 30 }),
    ),
  },
  { $id: 'CreateAgentKeyBody' },
);

export const RevokeAgentKeyBodySchema = Type.Object(
  {
    reason: AgentKeyRevocationReasonSchema,
    description: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
  },
  { $id: 'RevokeAgentKeyBody' },
);

export const AgentKeyParamsSchema = Type.Object(
  { keyId: Type.String({ minLength: 1 }) },
  { $id: 'AgentKeyParams' },
);

export const agentKeySchemas = [
  AgentKeyStatusSchema,
  AgentKeyRevocationReasonSchema,
  AgentKeySchema,
  AgentKeyWithSecretSchema,
  AgentKeyListSchema,
  CreateAgentKeyBodySchema,
  RevokeAgentKeyBodySchema,
  AgentKeyParamsSchema,
];
