export const COMMON_CREDENTIAL_SCOPES = [
  'diary:read',
  'diary:write',
  'team:read',
] as const;

export const AGENT_CREDENTIAL_SCOPES = [
  ...COMMON_CREDENTIAL_SCOPES,
  'crypto:sign',
  'agent:profile',
] as const;

export const HUMAN_SESSION_SCOPES = [
  ...COMMON_CREDENTIAL_SCOPES,
  'human:profile',
] as const;
