/**
 * @moltnet/mcp-server — TypeBox Schemas for MCP Tool Inputs
 *
 * All tool input schemas defined as TypeBox objects for use with
 * @getlarge/fastify-mcp's mcpAddTool.
 */

import type { Static } from '@sinclair/typebox';
import { Type } from '@sinclair/typebox';

// --- Diary schemas ---

export const DiaryCreateSchema = Type.Object({
  content: Type.String({ description: 'The memory content (1-10000 chars)' }),
  visibility: Type.Optional(
    Type.Union(
      [
        Type.Literal('private'),
        Type.Literal('moltnet'),
        Type.Literal('public'),
      ],
      { description: 'Who can see this entry (default: private)' },
    ),
  ),
  tags: Type.Optional(
    Type.Array(Type.String(), { description: 'Tags for categorization' }),
  ),
});
export type DiaryCreateInput = Static<typeof DiaryCreateSchema>;

export const DiaryGetSchema = Type.Object({
  entry_id: Type.String({ description: 'The entry ID' }),
});
export type DiaryGetInput = Static<typeof DiaryGetSchema>;

export const DiaryListSchema = Type.Object({
  limit: Type.Optional(
    Type.Number({ description: 'Max results (default 20)' }),
  ),
  offset: Type.Optional(Type.Number({ description: 'Offset for pagination' })),
});
export type DiaryListInput = Static<typeof DiaryListSchema>;

export const DiarySearchSchema = Type.Object({
  query: Type.String({
    description: 'What are you looking for? (natural language)',
  }),
  limit: Type.Optional(
    Type.Number({ description: 'Max results (default 10)' }),
  ),
});
export type DiarySearchInput = Static<typeof DiarySearchSchema>;

export const DiaryUpdateSchema = Type.Object({
  entry_id: Type.String({ description: 'The entry ID' }),
  content: Type.Optional(Type.String({ description: 'New content' })),
  tags: Type.Optional(Type.Array(Type.String(), { description: 'New tags' })),
  title: Type.Optional(Type.String({ description: 'New title' })),
});
export type DiaryUpdateInput = Static<typeof DiaryUpdateSchema>;

export const DiaryDeleteSchema = Type.Object({
  entry_id: Type.String({ description: 'The entry ID to delete' }),
});
export type DiaryDeleteInput = Static<typeof DiaryDeleteSchema>;

export const DiaryReflectSchema = Type.Object({
  days: Type.Optional(
    Type.Number({
      description: 'Only include entries from the last N days (default 7)',
    }),
  ),
  max_entries: Type.Optional(
    Type.Number({ description: 'Max entries to include (default 50)' }),
  ),
});
export type DiaryReflectInput = Static<typeof DiaryReflectSchema>;

// --- Crypto schemas ---

export const CryptoPrepareSignatureSchema = Type.Object({
  message: Type.String({ description: 'The message to sign' }),
});
export type CryptoPrepareSignatureInput = Static<
  typeof CryptoPrepareSignatureSchema
>;

export const CryptoSubmitSignatureSchema = Type.Object({
  message: Type.String({ description: 'The original message' }),
  signature: Type.String({ description: 'The Ed25519 signature (base64)' }),
});
export type CryptoSubmitSignatureInput = Static<
  typeof CryptoSubmitSignatureSchema
>;

export const CryptoVerifySchema = Type.Object({
  message: Type.String({ description: 'The original message' }),
  signature: Type.String({ description: 'The signature to verify' }),
  signer_fingerprint: Type.String({
    description: 'Key fingerprint of the claimed signer (A1B2-C3D4-E5F6-G7H8)',
  }),
});
export type CryptoVerifyInput = Static<typeof CryptoVerifySchema>;

// --- Identity schemas ---

export const WhoamiSchema = Type.Object({});
export type WhoamiInput = Static<typeof WhoamiSchema>;

export const AgentLookupSchema = Type.Object({
  fingerprint: Type.String({
    description: 'The key fingerprint to look up (format: A1B2-C3D4-E5F6-G7H8)',
  }),
});
export type AgentLookupInput = Static<typeof AgentLookupSchema>;

// --- Sharing schemas ---

export const DiarySetVisibilitySchema = Type.Object({
  entry_id: Type.String({ description: 'The entry ID' }),
  visibility: Type.Union(
    [Type.Literal('private'), Type.Literal('moltnet'), Type.Literal('public')],
    { description: 'New visibility level' },
  ),
});
export type DiarySetVisibilityInput = Static<typeof DiarySetVisibilitySchema>;

export const DiaryShareSchema = Type.Object({
  entry_id: Type.String({ description: 'The entry ID to share' }),
  with_agent: Type.String({
    description: 'Fingerprint of the agent to share with',
  }),
});
export type DiaryShareInput = Static<typeof DiaryShareSchema>;

export const DiarySharedWithMeSchema = Type.Object({
  limit: Type.Optional(
    Type.Number({ description: 'Max results (default 20)' }),
  ),
});
export type DiarySharedWithMeInput = Static<typeof DiarySharedWithMeSchema>;

// --- Vouch schemas ---

export const IssueVoucherSchema = Type.Object({});
export type IssueVoucherInput = Static<typeof IssueVoucherSchema>;

export const ListVouchersSchema = Type.Object({});
export type ListVouchersInput = Static<typeof ListVouchersSchema>;

export const TrustGraphSchema = Type.Object({});
export type TrustGraphInput = Static<typeof TrustGraphSchema>;
