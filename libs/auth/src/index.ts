/**
 * @moltnet/auth
 *
 * Authentication and authorization library for MoltNet.
 * Uses Ory Network (Hydra + Keto) for token validation and permission checks.
 */

export {
  type AgentKeyBindingScope,
  agentKeyMetadata,
  type AgentKeyMetadataBinding,
  readAgentKeyMetadataBinding,
} from './agent-key-binding.js';
export {
  AGENT_IDENTITY_SCHEMA_ID,
  KRATOS_COOKIE_NAME_REGEX,
  ORY_OPAQUE_PREFIXES,
  SESSION_TOKEN_HEADER,
  TALOS_API_KEY_PREFIXES,
  TEAM_HEADER,
} from './constants.js';
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
  RuntimePolicyPermission,
  RuntimePolicyRelation,
  RuntimeProfileRelation,
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
  populateAuthContext,
  requireAuth,
  requireScopes,
  routeUsesPrincipalAuth,
  type ScopeDenialEvent,
  type ScopeEnforcementMode,
  type TeamResolver,
} from './plugin.js';
export {
  createRelationshipReader,
  type DiaryGrantTuple,
  type GroupMemberTuple,
  type RelationshipReader,
  type TaskGrantTuple,
  type TeamIdWithRole,
  type TeamMemberTuple,
} from './relationship-reader.js';
export {
  createRelationshipWriter,
  type RelationshipWriter,
} from './relationship-writer.js';
export {
  createRemoteAuthMetrics,
  RemoteAuthCache,
  type RemoteAuthCacheOptions,
  type RemoteAuthMetrics,
  type RemoteAuthOperation,
  type RemoteAuthOutcome,
  type RemoteAuthTransport,
} from './remote-auth-cache.js';
export {
  asRemoteAuthenticationError,
  RemoteAuthenticationError,
  remoteErrorStatus,
} from './remote-auth-error.js';
export {
  AGENT_CREDENTIAL_SCOPES,
  AGENT_OAUTH_SCOPES,
  ALL_CREDENTIAL_SCOPES,
  CREDENTIAL_SCOPES,
  type CredentialScope,
  credentialScopeSetsEqual,
  HUMAN_SESSION_SCOPES,
  MCP_CLIENT_SCOPES,
} from './scopes.js';
export {
  createSessionResolver,
  type SessionResolver,
  type SessionResolverConfig,
} from './session-resolver.js';
export {
  compareShellCommandRules,
  decodeShellCommandIdentifier,
  encodeShellCommandRule,
  MAX_SHELL_COMMAND_IDENTIFIER_BYTES,
  MAX_SHELL_COMMAND_TOKEN_CHARACTERS,
  MAX_SHELL_COMMAND_TOKENS,
  MIN_SHELL_COMMAND_TOKENS,
  normalizeShellCommandRules,
  SHELL_COMMAND_ENCODING_VERSION,
  ShellCommandIdentifierError,
  type ShellCommandRule,
} from './shell-command.js';
export type { TeamInviteRole, TeamRole } from './team-role.js';
export {
  highestTeamRole,
  normalizeTeamRelation,
  TEAM_ROLE,
  teamRelationToRole,
  teamRoleRank,
  teamRoleToRelation,
} from './team-role.js';
export {
  createTokenValidator,
  type TalosAgentIdentity,
  type TalosAgentResolver,
  type TokenValidationEvent,
  type TokenValidationReason,
  type TokenValidator,
  type TokenValidatorConfig,
  type TokenValidatorLogger,
} from './token-validator.js';
export type {
  AgentAuthContext,
  AuthContext,
  HumanAuthContext,
  IntrospectionResult,
  IntrospectionResultActive,
  IntrospectionResultInactive,
  SubjectType,
  TalosCredentialBinding,
} from './types.js';
export type { OAuth2Client } from '@ory/client-fetch';
