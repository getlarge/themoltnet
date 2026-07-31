export const CREDENTIAL_SCOPES = {
  AgentProfile: 'agent:profile',
  ConnectorInvoke: 'connector:invoke',
  CryptoSign: 'crypto:sign',
  DiaryManage: 'diary:manage',
  DiaryRead: 'diary:read',
  DiaryWrite: 'diary:write',
  KeyManage: 'key:manage',
  PackRead: 'pack:read',
  PackWrite: 'pack:write',
  RuntimeManage: 'runtime:manage',
  RuntimeRead: 'runtime:read',
  TaskClaim: 'task:claim',
  TaskExecute: 'task:execute',
  TaskManage: 'task:manage',
  TaskRead: 'task:read',
  TeamManage: 'team:manage',
  TeamRead: 'team:read',
} as const;

export type CredentialScope =
  (typeof CREDENTIAL_SCOPES)[keyof typeof CREDENTIAL_SCOPES];

export const ALL_CREDENTIAL_SCOPES = Object.freeze(
  Object.values(CREDENTIAL_SCOPES),
);

/**
 * Minimum grant for the agent daemon. Task credentials attenuate this further
 * to `task:execute` alone.
 */
export const AGENT_CREDENTIAL_SCOPES = [
  CREDENTIAL_SCOPES.AgentProfile,
  CREDENTIAL_SCOPES.RuntimeRead,
  CREDENTIAL_SCOPES.TaskRead,
  CREDENTIAL_SCOPES.TaskClaim,
  CREDENTIAL_SCOPES.TaskExecute,
] as const satisfies readonly CredentialScope[];

/** Full grant for first-party OAuth2 agents and interactive human sessions. */
export const AGENT_OAUTH_SCOPES = ALL_CREDENTIAL_SCOPES;
export const HUMAN_SESSION_SCOPES = ALL_CREDENTIAL_SCOPES;
