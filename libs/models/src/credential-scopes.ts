export const CREDENTIAL_SCOPES = {
  AgentProfile: 'agent:profile',
  ConnectorInvoke: 'connector:invoke',
  CryptoSign: 'crypto:sign',
  DiaryManage: 'diary:manage',
  DiaryRead: 'diary:read',
  DiaryWrite: 'diary:write',
  HumanProfile: 'human:profile',
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

/** Compare two scope collections as exact, duplicate-free sets. */
export function credentialScopeSetsEqual(
  actual: readonly string[] | null | undefined,
  expected: readonly string[] | null | undefined,
): boolean {
  if (!actual || !expected || actual.length !== expected.length) return false;
  if (
    actual.some((scope) => !scope || scope.trim() !== scope) ||
    expected.some((scope) => !scope || scope.trim() !== scope)
  ) {
    return false;
  }

  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  return (
    actualSet.size === actual.length &&
    expectedSet.size === expected.length &&
    expected.every((scope) => actualSet.has(scope))
  );
}

export const ALL_CREDENTIAL_SCOPES = Object.freeze(
  Object.values(CREDENTIAL_SCOPES),
);

/**
 * Minimum grant for the agent daemon. Task credentials attenuate this further
 * to `task:execute` alone.
 *
 * `crypto:sign` is part of the minimum because host-capability signing runs on
 * the daemon's own credential: the local seed signer calls the signing-request
 * endpoints, which require it. A grant without it produces a daemon that boots
 * cleanly and then fails the first time guest code signs a diary entry or a
 * commit.
 */
export const AGENT_CREDENTIAL_SCOPES = [
  CREDENTIAL_SCOPES.AgentProfile,
  CREDENTIAL_SCOPES.CryptoSign,
  CREDENTIAL_SCOPES.RuntimeRead,
  CREDENTIAL_SCOPES.TaskRead,
  CREDENTIAL_SCOPES.TaskClaim,
  CREDENTIAL_SCOPES.TaskExecute,
] as const satisfies readonly CredentialScope[];

/** Full grant ceiling for first-party agent OAuth2 clients. */
export const AGENT_OAUTH_SCOPES = Object.freeze(
  ALL_CREDENTIAL_SCOPES.filter(
    (scope) => scope !== CREDENTIAL_SCOPES.HumanProfile,
  ),
);

/** Human sessions may also access human-profile capabilities. */
export const HUMAN_SESSION_SCOPES = ALL_CREDENTIAL_SCOPES;

/**
 * REST capabilities exercised by the current MCP tool surface.
 *
 * Intentionally excludes connector invocation, key management, runtime
 * management/read, and task claiming because MCP exposes none of those
 * operations.
 */
export const MCP_CLIENT_SCOPES = [
  CREDENTIAL_SCOPES.AgentProfile,
  CREDENTIAL_SCOPES.CryptoSign,
  CREDENTIAL_SCOPES.DiaryManage,
  CREDENTIAL_SCOPES.DiaryRead,
  CREDENTIAL_SCOPES.DiaryWrite,
  CREDENTIAL_SCOPES.HumanProfile,
  CREDENTIAL_SCOPES.PackRead,
  CREDENTIAL_SCOPES.PackWrite,
  CREDENTIAL_SCOPES.TaskExecute,
  CREDENTIAL_SCOPES.TaskManage,
  CREDENTIAL_SCOPES.TaskRead,
  CREDENTIAL_SCOPES.TeamManage,
  CREDENTIAL_SCOPES.TeamRead,
] as const satisfies readonly CredentialScope[];

/** MCP tool scopes that agent and other M2M credentials may request. */
export const MCP_M2M_SCOPES = MCP_CLIENT_SCOPES.filter(
  (scope) => scope !== CREDENTIAL_SCOPES.HumanProfile,
);
