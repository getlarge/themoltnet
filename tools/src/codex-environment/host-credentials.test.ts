import { createHostCapabilityRouter } from '@themoltnet/agent-runtime';
import { type MoltNetConfig, SecretProviderRegistry } from '@themoltnet/sdk';
import { describe, expect, it, vi } from 'vitest';

import {
  hostAuthenticationCapability,
  preflightHostCredential,
} from './host-credentials.js';

const identity = {
  agentName: 'probe-agent',
  identityId: 'identity-1',
  publicKey: `ed25519:${Buffer.alloc(32, 1).toString('base64')}`,
  fingerprint: 'AAAA-BBBB-CCCC-DDDD',
  gitName: 'Probe Agent',
  gitEmail: 'probe@example.test',
};

const config = {
  identity_id: identity.identityId,
  registered_at: '2026-01-01T00:00:00Z',
  oauth2: {
    client_id: 'client-1',
    client_secret_ref: { provider: 'fixture', key: 'bound-key' },
  },
  keys: {
    public_key: identity.publicKey,
    private_key: Buffer.alloc(32, 2).toString('base64'),
    fingerprint: identity.fingerprint,
  },
  endpoints: {
    api: 'https://api.themolt.net',
    mcp: 'https://mcp.themolt.net/mcp',
  },
} satisfies MoltNetConfig;

function createRouter(whoami: Record<string, unknown>) {
  const agent = {
    agents: { whoami: vi.fn(() => Promise.resolve(whoami)) },
  };
  const router = createHostCapabilityRouter({
    capabilities: [hostAuthenticationCapability],
    context: {
      taskId: 'probe',
      attemptN: 1,
      teamId: 'team',
      agent: agent as never,
      identity,
    },
    injected: {},
    paths: { mountPath: '/workspace' },
    logger: { info: vi.fn(), warn: vi.fn() },
  });
  router.setPolicy({
    enforcement: 'enforce',
    allowedTools: new Set(['capability:host-auth-check:whoami']),
  });
  return { agent, router };
}

describe('hostAuthenticationCapability', () => {
  it('returns only boolean authentication assertions', async () => {
    const { agent, router } = createRouter({
      ...identity,
      subjectType: 'agent',
    });

    const response = await router.origins[hostAuthenticationCapability.origin](
      new Request(`${hostAuthenticationCapability.origin}/whoami`, {
        method: 'POST',
        body: '{}',
        headers: { 'content-type': 'application/json' },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      authenticated: true,
      agentSubject: true,
      identityMatched: true,
    });
    expect(JSON.stringify(body)).not.toContain(identity.identityId);
    expect(JSON.stringify(body)).not.toContain(identity.publicKey);
    expect(agent.agents.whoami).toHaveBeenCalledOnce();
  });

  it('reports an identity mismatch without returning either identity', async () => {
    const { router } = createRouter({
      ...identity,
      identityId: 'other-identity',
      subjectType: 'agent',
    });

    const response = await router.origins[hostAuthenticationCapability.origin](
      new Request(`${hostAuthenticationCapability.origin}/whoami`, {
        method: 'POST',
        body: '{}',
        headers: { 'content-type': 'application/json' },
      }),
    );

    expect(await response.json()).toEqual({
      authenticated: true,
      agentSubject: true,
      identityMatched: false,
    });
  });
});

describe('preflightHostCredential', () => {
  it.each([
    ['value', 'ready'],
    [null, 'binding_absent'],
  ] as const)(
    'classifies a successful provider read of %j',
    async (value, reason) => {
      const providers = new SecretProviderRegistry().register({
        name: 'fixture',
        read: vi.fn(() => Promise.resolve(value)),
      });

      await expect(preflightHostCredential(config, providers)).resolves.toBe(
        reason,
      );
    },
  );

  it('classifies a provider read error as host_store_inaccessible', async () => {
    const providers = new SecretProviderRegistry().register({
      name: 'fixture',
      read: vi.fn(() => Promise.reject(new Error('denied by host sandbox'))),
    });

    await expect(preflightHostCredential(config, providers)).resolves.toBe(
      'host_store_inaccessible',
    );
  });

  it('classifies an unregistered provider separately', async () => {
    await expect(
      preflightHostCredential(config, new SecretProviderRegistry()),
    ).resolves.toBe('provider_unavailable');
  });
});
