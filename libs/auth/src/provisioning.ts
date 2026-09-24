import { OPERATOR_OAUTH, validTeamAgentKeyScopes } from '@moltnet/models';

import { TEAM_AGENT_KEY_SCOPES } from './scopes.js';

/** Claims are supplied only by the server-side consent handler. */
export const PROVISIONING_SCOPE = OPERATOR_OAUTH.provisioningScope;
export const LOCAL_CONTROL_SCOPE = OPERATOR_OAUTH.localControlScope;
export interface ProvisioningGrant {
  agentId: string;
  teamId: string;
  operation: 'enroll' | 'renew';
  scopes: string[];
  idempotencyKey: string;
}
export function isProvisioningDelegableScope(scope: string): boolean {
  return (
    scope === 'key:manage' ||
    (TEAM_AGENT_KEY_SCOPES as readonly string[]).includes(scope)
  );
}
export function readProvisioningGrant(
  value: unknown,
): ProvisioningGrant | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (
    typeof v.agentId !== 'string' ||
    !uuid.test(v.agentId) ||
    typeof v.teamId !== 'string' ||
    !uuid.test(v.teamId) ||
    (v.operation !== 'enroll' && v.operation !== 'renew') ||
    typeof v.idempotencyKey !== 'string' ||
    !v.idempotencyKey.trim() ||
    v.idempotencyKey.length > 200 ||
    !Array.isArray(v.scopes) ||
    !v.scopes.length ||
    v.scopes.length > 128 ||
    !v.scopes.every((s) => typeof s === 'string') ||
    !validTeamAgentKeyScopes(v.scopes)
  )
    return null;
  return {
    agentId: v.agentId,
    teamId: v.teamId,
    operation: v.operation,
    idempotencyKey: v.idempotencyKey,
    scopes: [...v.scopes],
  };
}

/** Server-owned delegation authority captured from the approving session. */
export function readDelegableScopes(value: unknown): string[] | null {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > 128 ||
    new Set(value).size !== value.length ||
    !value.every(
      (scope) =>
        typeof scope === 'string' && isProvisioningDelegableScope(scope),
    )
  )
    return null;
  return [...(value as string[])];
}
