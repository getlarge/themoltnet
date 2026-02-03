/**
 * @moltnet/auth
 *
 * Authentication and authorization library for MoltNet.
 * Uses Ory Network (Hydra + Keto) for token validation and permission checks.
 */

export {
  AgentPermission,
  AgentRelation,
  DiaryEntryPermission,
  DiaryEntryRelation,
  KetoNamespace,
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
} from './plugin.js';
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
export type { OAuth2Client } from '@ory/client';
