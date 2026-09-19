/** Claims are supplied only by the server-side consent handler. */
export const PROVISIONING_SCOPE = 'moltnet:provision';
export const LOCAL_CONTROL_SCOPE = 'moltnet:local-control';
export interface ProvisioningGrant {
  agentId: string;
  teamId: string;
  operation: 'enroll' | 'renew';
  scopes: string[];
  idempotencyKey: string;
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
    !v.scopes.every(
      (s) => typeof s === 'string' && s.length > 0 && s.length <= 256,
    )
  )
    return null;
  return {
    agentId: v.agentId,
    teamId: v.teamId,
    operation: v.operation,
    idempotencyKey: v.idempotencyKey,
    scopes: [...new Set(v.scopes as string[])],
  };
}
