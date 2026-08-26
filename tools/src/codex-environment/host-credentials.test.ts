import { createHostCapabilityRouter } from '@themoltnet/agent-runtime';
import type { MoltNetConfig } from '@themoltnet/sdk';
import { describe, expect, it, vi } from 'vitest';

import {
  hostAuthenticationCapability,
  preflightBrokeredHostCredential,
  withoutBrokeredMoltNetSecrets,
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

describe('preflightBrokeredHostCredential', () => {
  it('accepts the binding delivered by moltnet start', () => {
    expect(
      preflightBrokeredHostCredential(config, {
        MOLTNET_CLIENT_ID: config.oauth2.client_id,
        MOLTNET_CLIENT_SECRET: 'launch-only-secret',
      }),
    ).toBe('ready');
  });

  it('classifies an absent broker delivery separately from a missing binding', () => {
    expect(preflightBrokeredHostCredential(config, {})).toBe('delivery_failed');
  });

  it('rejects credentials delivered for a different client', () => {
    expect(
      preflightBrokeredHostCredential(config, {
        MOLTNET_CLIENT_ID: 'another-client',
        MOLTNET_CLIENT_SECRET: 'launch-only-secret',
      }),
    ).toBe('binding_requirement_mismatch');
  });

  it('reports a config with no logical secret binding', () => {
    const unbound = structuredClone(config);
    delete (unbound.oauth2 as Partial<typeof unbound.oauth2>).client_secret_ref;

    expect(preflightBrokeredHostCredential(unbound, {})).toBe(
      'required_binding_missing',
    );
  });
});

describe('withoutBrokeredMoltNetSecrets', () => {
  it('removes launch-only MoltNet secrets without stripping unrelated auth', () => {
    expect(
      withoutBrokeredMoltNetSecrets(
        {
          MOLTNET_CLIENT_ID: 'client-1',
          MOLTNET_CLIENT_SECRET: 'launch-only-secret',
          PROBE_AGENT_CLIENT_SECRET: 'launch-only-secret',
          MOLTNET_AGENT_KEY: 'agent-key',
          MOLTNET_CREDENTIALS_PATH: '/host/moltnet.json',
          OPENAI_API_KEY: 'unrelated-host-auth',
        },
        'launch-only-secret',
      ),
    ).toEqual({
      MOLTNET_CLIENT_ID: 'client-1',
      MOLTNET_CREDENTIALS_PATH: '/host/moltnet.json',
      OPENAI_API_KEY: 'unrelated-host-auth',
    });
  });
});
