/**
 * @moltnet/auth
 *
 * Authentication and authorization library for MoltNet.
 * Uses Ory Network (Hydra + Keto) for token validation and permission checks.
 */

export {
  AgentPermission,
  AgentRelation,
  ContextPackPermission,
  ContextPackRelation,
  DiaryEntryPermission,
  DiaryEntryRelation,
  DiaryPermission,
  DiaryRelation,
  HumanPermission,
  HumanRelation,
  KetoNamespace,
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
  type RelationshipReader,
  type TeamMemberTuple,
} from './relationship-reader.js';
export {
  createRelationshipWriter,
  type RelationshipWriter,
} from './relationship-writer.js';
export {
  createTokenValidator,
  type TokenValidator,
  type TokenValidatorConfig,
} from './token-validator.js';
export type {
  AuthContext,
  IntrospectionResult,
  IntrospectionResultActive,
  IntrospectionResultInactive,
} from './types.js';
export type { OAuth2Client } from '@ory/client-fetch';
