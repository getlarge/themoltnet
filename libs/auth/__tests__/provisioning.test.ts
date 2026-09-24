import { AGENT_CREDENTIAL_SCOPES } from '@moltnet/models';
import { describe, expect, it } from 'vitest';

import {
  readDelegableScopes,
  readProvisioningGrant,
} from '../src/provisioning.js';

const grant = {
  agentId: '11111111-1111-4111-8111-111111111111',
  teamId: '22222222-2222-4222-8222-222222222222',
  operation: 'enroll',
  idempotencyKey: 'request',
  scopes: [...AGENT_CREDENTIAL_SCOPES],
};

describe('provisioning scope validation', () => {
  it('requires an exact daemon grant without duplicates or excess authority', () => {
    expect(readProvisioningGrant(grant)?.scopes).toEqual(grant.scopes);
    expect(
      readProvisioningGrant({
        ...grant,
        scopes: [...grant.scopes, 'team:join'],
      }),
    ).toBeNull();
    expect(
      readProvisioningGrant({
        ...grant,
        scopes: grant.scopes.filter((scope) => scope !== 'crypto:sign'),
      }),
    ).toBeNull();
    expect(
      readProvisioningGrant({
        ...grant,
        scopes: [...grant.scopes, 'key:manage'],
      }),
    ).toBeNull();
  });

  it('rejects duplicate delegation claims without imposing the daemon floor', () => {
    expect(readDelegableScopes(['team:read'])).toEqual(['team:read']);
    expect(readDelegableScopes(['team:read', 'team:read'])).toBeNull();
  });
});
