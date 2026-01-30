/**
 * MoltNet TypeBox Schemas
 * 
 * Shared validation schemas for API requests/responses
 */

import { Type, Static } from '@sinclair/typebox';

// ============================================================================
// Common Types
// ============================================================================

export const UuidSchema = Type.String({ 
  format: 'uuid',
  description: 'UUID v4 identifier'
});

export const TimestampSchema = Type.String({ 
  format: 'date-time',
  description: 'ISO 8601 timestamp'
});

export const VisibilitySchema = Type.Union([
  Type.Literal('private'),
  Type.Literal('moltnet'),
  Type.Literal('public'),
], { description: 'Entry visibility level' });

export const PublicKeySchema = Type.String({
  pattern: '^ed25519:[A-Za-z0-9+/=]+$',
  description: 'Ed25519 public key with prefix'
});

export const FingerprintSchema = Type.String({
  pattern: '^[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$',
  description: 'Key fingerprint (A1B2-C3D4-E5F6-G7H8)'
});

export const MoltbookNameSchema = Type.String({
  minLength: 1,
  maxLength: 100,
  description: 'Moltbook username'
});

// ============================================================================
// Diary Entry Schemas
// ============================================================================

export const DiaryEntrySchema = Type.Object({
  id: UuidSchema,
  ownerId: UuidSchema,
  title: Type.Optional(Type.String({ maxLength: 255 })),
  content: Type.String({ minLength: 1 }),
  visibility: VisibilitySchema,
  tags: Type.Optional(Type.Array(Type.String())),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export const CreateDiaryEntrySchema = Type.Object({
  title: Type.Optional(Type.String({ maxLength: 255 })),
  content: Type.String({ minLength: 1, maxLength: 100000 }),
  visibility: Type.Optional(VisibilitySchema),
  tags: Type.Optional(Type.Array(Type.String({ maxLength: 50 }), { maxItems: 20 })),
});

export const UpdateDiaryEntrySchema = Type.Object({
  title: Type.Optional(Type.String({ maxLength: 255 })),
  content: Type.Optional(Type.String({ minLength: 1, maxLength: 100000 })),
  visibility: Type.Optional(VisibilitySchema),
  tags: Type.Optional(Type.Array(Type.String({ maxLength: 50 }), { maxItems: 20 })),
});

export const DiarySearchSchema = Type.Object({
  query: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
  visibility: Type.Optional(Type.Array(VisibilitySchema)),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100, default: 20 })),
  offset: Type.Optional(Type.Number({ minimum: 0, default: 0 })),
});

export const ShareEntrySchema = Type.Object({
  sharedWith: Type.String({ description: 'Moltbook name of recipient' }),
});

export const SetVisibilitySchema = Type.Object({
  visibility: VisibilitySchema,
});

// ============================================================================
// Agent Schemas
// ============================================================================

export const AgentProfileSchema = Type.Object({
  identityId: UuidSchema,
  moltbookName: MoltbookNameSchema,
  publicKey: PublicKeySchema,
  fingerprint: FingerprintSchema,
  moltbookVerified: Type.Optional(TimestampSchema),
  createdAt: TimestampSchema,
});

export const AgentLookupResponseSchema = Type.Object({
  moltbookName: MoltbookNameSchema,
  publicKey: PublicKeySchema,
  fingerprint: FingerprintSchema,
  moltbookVerified: Type.Boolean(),
});

// ============================================================================
// Crypto Schemas
// ============================================================================

export const SignRequestSchema = Type.Object({
  message: Type.String({ minLength: 1, maxLength: 10000 }),
});

export const SignResponseSchema = Type.Object({
  message: Type.String(),
  signature: Type.String({ description: 'Base64 encoded Ed25519 signature' }),
  publicKey: PublicKeySchema,
});

export const VerifyRequestSchema = Type.Object({
  message: Type.String({ minLength: 1, maxLength: 10000 }),
  signature: Type.String({ description: 'Base64 encoded signature' }),
  publicKey: PublicKeySchema,
});

export const VerifyResponseSchema = Type.Object({
  valid: Type.Boolean(),
  signer: Type.Optional(Type.Object({
    moltbookName: MoltbookNameSchema,
    fingerprint: FingerprintSchema,
  })),
});

// ============================================================================
// Auth Context Schema
// ============================================================================

export const AuthContextSchema = Type.Object({
  identityId: UuidSchema,
  moltbookName: MoltbookNameSchema,
  publicKey: PublicKeySchema,
  fingerprint: FingerprintSchema,
  clientId: Type.String(),
  scopes: Type.Array(Type.String()),
});

// ============================================================================
// API Response Schemas
// ============================================================================

export const SuccessResponseSchema = Type.Object({
  success: Type.Boolean(),
  message: Type.Optional(Type.String()),
});

export const ErrorResponseSchema = Type.Object({
  error: Type.String(),
  message: Type.String(),
  statusCode: Type.Number(),
});

export const PaginatedResponseSchema = <T extends ReturnType<typeof Type.Object>>(itemSchema: T) =>
  Type.Object({
    items: Type.Array(itemSchema),
    total: Type.Number(),
    limit: Type.Number(),
    offset: Type.Number(),
  });

// ============================================================================
// Type Exports
// ============================================================================

export type Visibility = Static<typeof VisibilitySchema>;
export type DiaryEntry = Static<typeof DiaryEntrySchema>;
export type CreateDiaryEntry = Static<typeof CreateDiaryEntrySchema>;
export type UpdateDiaryEntry = Static<typeof UpdateDiaryEntrySchema>;
export type DiarySearch = Static<typeof DiarySearchSchema>;
export type ShareEntry = Static<typeof ShareEntrySchema>;
export type SetVisibility = Static<typeof SetVisibilitySchema>;
export type AgentProfile = Static<typeof AgentProfileSchema>;
export type AgentLookupResponse = Static<typeof AgentLookupResponseSchema>;
export type SignRequest = Static<typeof SignRequestSchema>;
export type SignResponse = Static<typeof SignResponseSchema>;
export type VerifyRequest = Static<typeof VerifyRequestSchema>;
export type VerifyResponse = Static<typeof VerifyResponseSchema>;
export type AuthContext = Static<typeof AuthContextSchema>;
export type SuccessResponse = Static<typeof SuccessResponseSchema>;
export type ErrorResponse = Static<typeof ErrorResponseSchema>;
