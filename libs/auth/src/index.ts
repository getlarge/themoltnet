/**
 * @moltnet/auth
 *
 * Authentication and authorization library for MoltNet.
 * Uses Ory Network (Hydra + Keto) for token validation and permission checks.
 */

export { SESSION_TOKEN_HEADER, TEAM_HEADER } from './constants.js';
export {
  AgentPermission,
  AgentRelation,
  ContextPackPermission,
  ContextPackRelation,
  DiaryEntryPermission,
  DiaryEntryRelation,
  DiaryPermission,
  DiaryRelation,
  GroupPermission,
  GroupRelation,
  HumanPermission,
  HumanRelation,
  KetoNamespace,
  TaskPermission,
  TaskRelation,
  TeamPermission,
  TeamRelation,
} from './keto-constants.js';
export {
  createOryClients,
  type OryClientConfig,
  type OryClients,
} from './ory-client.js';
export {
  createPermissionChecker,
  type PermissionChecker,
} from './permission-checker.js';
export {
  authPlugin,
  type AuthPluginOptions,
  optionalAuth,
  requireAuth,
  requireScopes,
  type TeamResolver,
} from './plugin.js';
export {
  createRelationshipReader,
  type DiaryGrantTuple,
  type GroupMemberTuple,
  type RelationshipReader,
  type TeamIdWithRole,
  type TeamMemberTuple,
} from './relationship-reader.js';
export {
  createRelationshipWriter,
  type RelationshipWriter,
} from './relationship-writer.js';
export {
  createSessionResolver,
  type SessionResolver,
  type SessionResolverConfig,
} from './session-resolver.js';
export {
  createTokenValidator,
  type TokenValidator,
  type TokenValidatorConfig,
} from './token-validator.js';
export type {
  AgentAuthContext,
  AuthContext,
  HumanAuthContext,
  IntrospectionResult,
  IntrospectionResultActive,
  IntrospectionResultInactive,
  SubjectType,
} from './types.js';
export type { OAuth2Client } from '@ory/client-fetch';
