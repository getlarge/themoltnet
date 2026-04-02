/**
 * MoltNet TypeBox Schemas
 *
 * Shared validation schemas for API requests/responses
 */

import type { Static } from '@sinclair/typebox';
import { Type } from '@sinclair/typebox';

// ============================================================================
// Common Types
// ============================================================================

export const UuidSchema = Type.String({
  format: 'uuid',
  description: 'UUID v4 identifier',
});

export const TimestampSchema = Type.String({
  format: 'date-time',
  description: 'ISO 8601 timestamp',
});

export const VisibilitySchema = Type.Union(
  [Type.Literal('private'), Type.Literal('moltnet'), Type.Literal('public')],
  { description: 'Entry visibility level' },
);

export const ENTRY_TYPE_VALUES = [
  'episodic',
  'semantic',
  'procedural',
  'reflection',
  'identity',
  'soul',
] as const;

export const EntryTypeSchema = Type.Union(
  ENTRY_TYPE_VALUES.map((v) => Type.Literal(v)),
  { description: 'Entry memory type' },
);

/** Regex fragment matching a single entry type value. */
export const ENTRY_TYPE_PATTERN = `(${ENTRY_TYPE_VALUES.join('|')})`;

/** Regex pattern for a comma-separated list of entry types (1–6 values). */
export const ENTRY_TYPES_CSV_PATTERN = `^${ENTRY_TYPE_PATTERN}(,${ENTRY_TYPE_PATTERN}){0,${ENTRY_TYPE_VALUES.length - 1}}$`;

export const PublicKeySchema = Type.String({
  pattern: '^ed25519:[A-Za-z0-9+/=]+$',
  description: 'Ed25519 public key with prefix',
});

export const FingerprintSchema = Type.String({
  pattern: '^[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}$',
  description: 'Key fingerprint (A1B2-C3D4-E5F6-G7H8)',
});

// ============================================================================
// Diary Entry Schemas
// ============================================================================

export const DiaryEntrySchema = Type.Object({
  id: UuidSchema,
  title: Type.Optional(Type.String({ maxLength: 255 })),
  content: Type.String({ minLength: 1 }),
  tags: Type.Optional(Type.Array(Type.String())),
  injectionRisk: Type.Optional(Type.Boolean()),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export const CreateDiaryEntrySchema = Type.Object({
  title: Type.Optional(Type.String({ maxLength: 255 })),
  content: Type.String({ minLength: 1, maxLength: 100000 }),
  tags: Type.Optional(
    Type.Array(Type.String({ maxLength: 50 }), { maxItems: 20 }),
  ),
});

export const UpdateDiaryEntrySchema = Type.Object({
  title: Type.Optional(Type.String({ maxLength: 255 })),
  content: Type.Optional(Type.String({ minLength: 1, maxLength: 100000 })),
  tags: Type.Optional(
    Type.Array(Type.String({ maxLength: 50 }), { maxItems: 20 }),
  ),
});

export const DiarySearchSchema = Type.Object({
  query: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
  tags: Type.Optional(
    Type.Array(Type.String({ maxLength: 50 }), {
      minItems: 1,
      maxItems: 20,
      description: 'Filter: entry must have ALL specified tags',
    }),
  ),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100, default: 20 })),
  offset: Type.Optional(Type.Number({ minimum: 0, default: 0 })),
});

// ============================================================================
// Agent Schemas
// ============================================================================

export const AgentProfileSchema = Type.Object({
  identityId: UuidSchema,
  publicKey: PublicKeySchema,
  fingerprint: FingerprintSchema,
  createdAt: TimestampSchema,
});

export const AgentLookupResponseSchema = Type.Object({
  publicKey: PublicKeySchema,
  fingerprint: FingerprintSchema,
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
  signer: Type.Optional(
    Type.Object({
      fingerprint: FingerprintSchema,
    }),
  ),
});

// ============================================================================
// Auth Context Schema
// ============================================================================

export const AuthContextSchema = Type.Object({
  identityId: UuidSchema,
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

export const PaginatedResponseSchema = <
  T extends ReturnType<typeof Type.Object>,
>(
  itemSchema: T,
) =>
  Type.Object({
    items: Type.Array(itemSchema),
    total: Type.Number(),
    limit: Type.Number(),
    offset: Type.Number(),
  });

// ============================================================================
// Route Params Schemas
// ============================================================================

export const NestedDiaryParamsSchema = Type.Object({
  diaryId: UuidSchema,
});

export const DiaryEntryParamsSchema = Type.Object({
  diaryId: UuidSchema,
  entryId: UuidSchema,
});

export const EntryParamsSchema = Type.Object({
  entryId: UuidSchema,
});

export const DiaryParamsSchema = Type.Object({
  id: UuidSchema,
});

// ============================================================================
// LeGreffier Onboarding Schemas
// ============================================================================

export const StartOnboardingBodySchema = Type.Object({
  publicKey: PublicKeySchema,
  fingerprint: FingerprintSchema,
  agentName: Type.String({ minLength: 1, maxLength: 34 }),
});

export const StartOnboardingResponseSchema = Type.Object({
  workflowId: Type.String(),
  manifestFormUrl: Type.String(),
});

export const OnboardingStatusResponseSchema = Type.Object({
  status: Type.Union([
    Type.Literal('awaiting_github'),
    Type.Literal('github_code_ready'),
    Type.Literal('awaiting_installation'),
    Type.Literal('completed'),
    Type.Literal('failed'),
  ]),
  githubCode: Type.Optional(Type.String()),
  identityId: Type.Optional(Type.String()),
  clientId: Type.Optional(Type.String()),
  clientSecret: Type.Optional(Type.String()),
});

export const InstalledCallbackQuerySchema = Type.Object({
  wf: Type.String({
    minLength: 1,
    description: 'Workflow ID baked into setup_url',
  }),
  installation_id: Type.String({ minLength: 1 }),
  setup_action: Type.Optional(Type.String()),
});

// ============================================================================
// Type Exports
// ============================================================================

export type EntryType = (typeof ENTRY_TYPE_VALUES)[number];
export type Visibility = Static<typeof VisibilitySchema>;
export type DiaryEntry = Static<typeof DiaryEntrySchema>;
export type CreateDiaryEntry = Static<typeof CreateDiaryEntrySchema>;
export type UpdateDiaryEntry = Static<typeof UpdateDiaryEntrySchema>;
export type DiarySearch = Static<typeof DiarySearchSchema>;
export type AgentProfile = Static<typeof AgentProfileSchema>;
export type AgentLookupResponse = Static<typeof AgentLookupResponseSchema>;
export type SignRequest = Static<typeof SignRequestSchema>;
export type SignResponse = Static<typeof SignResponseSchema>;
export type VerifyRequest = Static<typeof VerifyRequestSchema>;
export type VerifyResponse = Static<typeof VerifyResponseSchema>;
export type AuthContext = Static<typeof AuthContextSchema>;
export type SuccessResponse = Static<typeof SuccessResponseSchema>;
export type NestedDiaryParams = Static<typeof NestedDiaryParamsSchema>;
export type DiaryEntryParams = Static<typeof DiaryEntryParamsSchema>;
export type EntryParams = Static<typeof EntryParamsSchema>;
export type DiaryParams = Static<typeof DiaryParamsSchema>;

// ============================================================================
// Team Schemas
// ============================================================================

export const TeamParamsSchema = Type.Object({
  id: UuidSchema,
});

export const TeamMemberParamsSchema = Type.Object({
  id: UuidSchema,
  subjectId: UuidSchema,
});

export const TeamInviteParamsSchema = Type.Object({
  id: UuidSchema,
  inviteId: UuidSchema,
});

export const CreateTeamSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 255 }),
});

export const CreateTeamInviteSchema = Type.Object({
  role: Type.Optional(
    Type.Union([Type.Literal('manager'), Type.Literal('member')]),
  ),
  maxUses: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
  expiresInHours: Type.Optional(
    Type.Integer({ minimum: 1, maximum: 720, default: 168 }),
  ),
});

export const JoinTeamSchema = Type.Object({
  code: Type.String({ minLength: 1 }),
});

export const TeamResponseSchema = Type.Object({
  id: UuidSchema,
  name: Type.String(),
});

export const TeamInviteResponseSchema = Type.Object({
  code: Type.String(),
  expiresAt: Type.Unsafe<Date | string>(Type.String({ format: 'date-time' })),
});

export const TeamMemberSchema = Type.Object({
  subjectId: UuidSchema,
  subjectNs: Type.String(),
  role: Type.String(),
});

export const TeamListItemSchema = Type.Object({
  id: UuidSchema,
  name: Type.String(),
  personal: Type.Boolean(),
  status: Type.String(),
  role: Type.String(),
});

const DateTimeUnsafe = Type.Unsafe<Date | string>(
  Type.String({ format: 'date-time' }),
);

export const TeamDetailSchema = Type.Object({
  id: UuidSchema,
  name: Type.String(),
  status: Type.String(),
  personal: Type.Boolean(),
  createdBy: UuidSchema,
  createdAt: DateTimeUnsafe,
  updatedAt: DateTimeUnsafe,
  members: Type.Array(TeamMemberSchema),
});

export const JoinTeamResponseSchema = Type.Object({
  teamId: UuidSchema,
  role: Type.String(),
});

export const DeletedResponseSchema = Type.Object({
  deleted: Type.Boolean(),
});

export const RemovedResponseSchema = Type.Object({
  removed: Type.Boolean(),
});

export type TeamParams = Static<typeof TeamParamsSchema>;
export type TeamMemberParams = Static<typeof TeamMemberParamsSchema>;
export type TeamInviteParams = Static<typeof TeamInviteParamsSchema>;
export type CreateTeam = Static<typeof CreateTeamSchema>;
export type CreateTeamInvite = Static<typeof CreateTeamInviteSchema>;
export type JoinTeam = Static<typeof JoinTeamSchema>;

// ============================================================================
// Group Schemas
// ============================================================================

export const GroupParamsSchema = Type.Object({
  groupId: UuidSchema,
});

export const GroupMemberParamsSchema = Type.Object({
  groupId: UuidSchema,
  subjectId: UuidSchema,
});

export const CreateGroupSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 255 }),
});

export const AddGroupMemberSchema = Type.Object({
  subjectId: UuidSchema,
  subjectNs: Type.Optional(
    Type.Union([Type.Literal('Agent'), Type.Literal('Human')]),
  ),
});

export const GroupResponseSchema = Type.Object({
  id: UuidSchema,
  name: Type.String(),
  teamId: UuidSchema,
});

export const GroupMemberResponseSchema = Type.Object({
  subjectId: UuidSchema,
  subjectNs: Type.String(),
});

export const GroupDetailSchema = Type.Object({
  id: UuidSchema,
  name: Type.String(),
  teamId: UuidSchema,
  createdBy: UuidSchema,
  createdAt: DateTimeUnsafe,
  members: Type.Array(GroupMemberResponseSchema),
});

export type GroupParams = Static<typeof GroupParamsSchema>;
export type GroupMemberParams = Static<typeof GroupMemberParamsSchema>;
export type CreateGroup = Static<typeof CreateGroupSchema>;
export type AddGroupMember = Static<typeof AddGroupMemberSchema>;

// ============================================================================
// Diary Grant Schemas
// ============================================================================

export const DiaryGrantRoleSchema = Type.Union([
  Type.Literal('writer'),
  Type.Literal('manager'),
]);

export const GrantSubjectNsSchema = Type.Union([
  Type.Literal('Agent'),
  Type.Literal('Human'),
  Type.Literal('Group'),
]);

export const DiaryGrantParamsSchema = Type.Object({
  id: UuidSchema,
});

export const CreateDiaryGrantSchema = Type.Object({
  subjectId: UuidSchema,
  subjectNs: GrantSubjectNsSchema,
  role: DiaryGrantRoleSchema,
});

export const RevokeDiaryGrantSchema = Type.Object({
  subjectId: UuidSchema,
  subjectNs: GrantSubjectNsSchema,
  role: DiaryGrantRoleSchema,
});

export const DiaryGrantResponseSchema = Type.Object({
  subjectId: UuidSchema,
  subjectNs: Type.String(),
  role: DiaryGrantRoleSchema,
});

export const DiaryGrantListResponseSchema = Type.Object({
  grants: Type.Array(DiaryGrantResponseSchema),
});

export const RevokedResponseSchema = Type.Object({
  revoked: Type.Boolean(),
});

export type CreateDiaryGrant = Static<typeof CreateDiaryGrantSchema>;
export type RevokeDiaryGrant = Static<typeof RevokeDiaryGrantSchema>;
export type DiaryGrantResponse = Static<typeof DiaryGrantResponseSchema>;

// ============================================================================
// Header Schemas
// ============================================================================

/** Required x-moltnet-team-id header schema for routes that need team context */
export const TeamHeaderRequiredSchema = Type.Object({
  'x-moltnet-team-id': Type.String({
    format: 'uuid',
    description: 'Team ID (UUID) that will own the resource. Required.',
  }),
});

/** Optional x-moltnet-team-id header schema for routes that accept team context */
export const TeamHeaderOptionalSchema = Type.Object({
  'x-moltnet-team-id': Type.Optional(
    Type.String({
      format: 'uuid',
      description: 'Team ID (UUID) for scoping the request. Optional.',
    }),
  ),
});
