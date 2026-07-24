const DIARY_SCOPES = ['diary:read', 'diary:write'] as const;

export const COMMON_CREDENTIAL_SCOPES = [...DIARY_SCOPES, 'team:read'] as const;

export const AGENT_CREDENTIAL_SCOPES = [
  ...DIARY_SCOPES,
  'crypto:sign',
  'agent:profile',
  'team:read',
] as const;

export const HUMAN_SESSION_SCOPES = [
  ...DIARY_SCOPES,
  'human:profile',
  'team:read',
] as const;
