/**
 * @moltnet/auth
 *
 * Authentication and authorization library for MoltNet.
 * Uses Ory Network (Hydra + Keto) for token validation and permission checks.
 */

export {
  createOryClients,
  type OryClients,
  type OryClientConfig,
} from './ory-client.js';
export {
  createTokenValidator,
  type TokenValidator,
} from './token-validator.js';
export {
  createPermissionChecker,
  type PermissionChecker,
} from './permission-checker.js';
export {
  authPlugin,
  requireAuth,
  optionalAuth,
  requireScopes,
  type AuthPluginOptions,
} from './plugin.js';
export type {
  AuthContext,
  IntrospectionResult,
  IntrospectionResultActive,
  IntrospectionResultInactive,
} from './types.js';
