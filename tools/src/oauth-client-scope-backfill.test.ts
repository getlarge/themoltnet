import { describe, expect, it, vi } from 'vitest';

import {
  backfillOAuthClientScopes,
  nextPageTokenFromLink,
  type OAuth2ClientRecord,
  planClientScope,
} from './oauth-client-scope-backfill.js';

const EXPECTED = ['agent:profile', 'task:read', 'task:write'] as const;

function agentClient(
  clientId: string,
  scope: string,
  metadata: unknown = { type: 'moltnet_agent' },
): OAuth2ClientRecord {
  return {
    client_id: clientId,
    client_name: `Agent: ${clientId}`,
    scope,
    metadata,
  };
}

function adaptersFor(pages: OAuth2ClientRecord[][]) {
  const setClientScope = vi.fn(async () => undefined);
  const listClients = vi.fn(async ({ pageToken }: { pageToken?: string }) => {
    const index = pageToken ? Number(pageToken) : 0;
    const items = pages[index] ?? [];
    const nextPageToken =
      index + 1 < pages.length ? String(index + 1) : undefined;
    return { items, nextPageToken };
  });
  return { listClients, setClientScope };
}

describe('planClientScope', () => {
  it('appends only the missing scopes after the existing ones', () => {
    // Arrange
    const client = agentClient('c1', 'task:read agent:profile');

    // Act
    const plan = planClientScope(client, EXPECTED);

    // Assert
    expect(plan).toEqual({
      clientId: 'c1',
      clientName: 'Agent: c1',
      missing: ['task:write'],
      scope: 'task:read agent:profile task:write',
    });
  });

  it('returns null when nothing is missing or the client has no id', () => {
    expect(
      planClientScope(agentClient('c1', EXPECTED.join(' ')), EXPECTED),
    ).toBeNull();
    expect(planClientScope({ scope: '' }, EXPECTED)).toBeNull();
  });
});

describe('backfillOAuthClientScopes', () => {
  it('dry-run walks every page, plans agent clients only, and writes nothing', async () => {
    // Arrange
    const adapters = adaptersFor([
      [
        agentClient('stale', 'agent:profile task:read'),
        agentClient('dcr', 'agent:profile', { type: 'other' }),
        { client_id: 'no-meta', scope: 'agent:profile' },
      ],
      [agentClient('current', EXPECTED.join(' '))],
    ]);

    // Act
    const result = await backfillOAuthClientScopes(
      adapters,
      'dry-run',
      EXPECTED,
    );

    // Assert
    expect(adapters.listClients).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      mode: 'dry-run',
      scanned: 4,
      agentClients: 2,
      applied: 0,
    });
    expect(result.planned.map((plan) => plan.clientId)).toEqual(['stale']);
    expect(adapters.setClientScope).not.toHaveBeenCalled();
  });

  it('apply patches each planned client with the merged scope string', async () => {
    // Arrange
    const adapters = adaptersFor([
      [
        agentClient('a', 'agent:profile'),
        agentClient('b', 'task:read'),
        agentClient('ok', EXPECTED.join(' ')),
      ],
    ]);
    const onProgress = vi.fn();

    // Act
    const result = await backfillOAuthClientScopes(
      { ...adapters, onProgress },
      'apply',
      EXPECTED,
    );

    // Assert
    expect(result.applied).toBe(2);
    expect(adapters.setClientScope.mock.calls).toEqual([
      ['a', 'agent:profile task:read task:write'],
      ['b', 'task:read agent:profile task:write'],
    ]);
    expect(onProgress).toHaveBeenLastCalledWith({ completed: 2, total: 2 });
  });

  it('verify fails loudly while any agent client still lacks a scope', async () => {
    // Arrange
    const adapters = adaptersFor([[agentClient('stale', 'agent:profile')]]);

    // Act / Assert
    await expect(
      backfillOAuthClientScopes(adapters, 'verify', EXPECTED),
    ).rejects.toThrow(/stale \(task:read, task:write\)/);
    expect(adapters.setClientScope).not.toHaveBeenCalled();
  });

  it('verify passes once every agent client carries the expected scopes', async () => {
    const adapters = adaptersFor([[agentClient('a', EXPECTED.join(' '))]]);

    await expect(
      backfillOAuthClientScopes(adapters, 'verify', EXPECTED),
    ).resolves.toMatchObject({ planned: [], applied: 0 });
  });
});

describe('nextPageTokenFromLink', () => {
  it('reads the next page token from a Hydra Link header', () => {
    const link =
      '<https://auth.example/admin/clients?page_size=250&page_token=eyJ0b2tlbiI6IjEyMyJ9>; rel="next",' +
      '<https://auth.example/admin/clients?page_size=250&page_token=first>; rel="first"';
    expect(nextPageTokenFromLink(link)).toBe('eyJ0b2tlbiI6IjEyMyJ9');
  });

  it('returns undefined on the last page', () => {
    expect(nextPageTokenFromLink(null)).toBeUndefined();
    expect(
      nextPageTokenFromLink(
        '<https://auth.example/admin/clients?page_token=x>; rel="first"',
      ),
    ).toBeUndefined();
  });
});
