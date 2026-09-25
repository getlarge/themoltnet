/** Each array element is an alternative authentication method (OpenAPI OR). */
export const PRINCIPAL_AUTH_SECURITY: Record<string, string[]>[] = [
  { bearerAuth: [] },
  { agentKeyAuth: [] },
  { sessionAuth: [] },
  { cookieAuth: [] },
];

export const OAUTH_OR_AGENT_KEY_SECURITY: Record<string, string[]>[] = [
  { bearerAuth: [] },
  { agentKeyAuth: [] },
];

export const OAUTH_BEARER_SECURITY: Record<string, string[]>[] = [
  { bearerAuth: [] },
];

export const HUMAN_SESSION_SECURITY: Record<string, string[]>[] = [
  { sessionAuth: [] },
  { cookieAuth: [] },
];
