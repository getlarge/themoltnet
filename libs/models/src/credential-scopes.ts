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

/**
 * OIDC protocol scopes. Not MoltNet capabilities — they carry no REST
 * authorization — so every capability cap has to allow them through
 * explicitly rather than treating them as over-grants.
 */
export const OIDC_PROTOCOL_SCOPES = [
  'openid',
  'offline',
  'offline_access',
] as const;

/**
 * Ceiling for a self-registered (Dynamic Client Registration) OAuth2 client.
 *
 * DCR is deliberately open — chat agents cannot connect to the MCP server any
 * other way — so registration is not a trust boundary and the grant it hands
 * out is the only thing standing between an anonymous registrant and the API.
 * Capping it at the MCP tool surface keeps `key:manage`, `runtime:manage`,
 * `connector:invoke`, `runtime:read` and `task:claim` unreachable by
 * self-registration: no client that registered without proving anything can
 * mint agent keys, drive the runtime, or claim work.
 *
 * First-party clients are unaffected. Both creation sites
 * (`registration-workflow.ts`, `libs/bootstrap`) stamp `metadata.identity_id`,
 * which routes them down the agent path in the Hydra token hook, and the
 * Console authenticates with Kratos sessions rather than OAuth2 at all.
 *
 * Two layers, and this constant is used for both — they are not the same
 * thing:
 *
 * - In Ory's `dynamic_client_registration.default_scope` it is only the
 *   **default** applied to a registration that names no scopes. A registrant
 *   that asks for something else is not stopped there.
 * - In the Hydra token hook it is the **enforced** ceiling: a token whose
 *   granted scopes exceed it is refused. That is what actually makes a
 *   privileged scope unreachable by self-registration.
 *
 * Derived on purpose: when MCP grows a tool that needs a new capability, adding
 * it to `MCP_CLIENT_SCOPES` moves this cap with it, and
 * `tools/src/credential-scope-config.test.ts` fails until the Ory configs
 * follow. The corollary is the part to keep in mind — **every scope added to
 * `MCP_CLIENT_SCOPES` is also handed to anonymous self-registrants.** That is
 * the right default, since DCR clients are MCP clients, but it makes widening
 * that list a security decision rather than a routine one.
 */
export const DCR_MAX_SCOPES: readonly string[] = Object.freeze([
  ...OIDC_PROTOCOL_SCOPES,
  ...MCP_CLIENT_SCOPES,
]);
