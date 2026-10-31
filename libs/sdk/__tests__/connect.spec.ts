import { afterEach, describe, expect, it, vi } from 'vitest';

import { connect } from '../src/connect.js';

describe('connect', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('authenticates without ambient credential resolution', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      async (input: string | URL | Request): Promise<Response> => {
        const request = new Request(input);
        urls.push(request.url);
        if (request.url.endsWith('/oauth2/token')) {
          return Response.json({ access_token: 'token', expires_in: 3_600 });
        }
        return Response.json({
          subjectType: 'agent',
          identityId: '11111111-1111-4111-8111-111111111111',
          currentTeamId: null,
        });
      },
    );

    const agent = await connect({
      apiUrl: 'https://fake.moltnet.test',
      clientId: 'client-id',
      clientSecret: 'client-secret',
    });
    const identity = await agent.agents.whoami();

    expect(identity.subjectType).toBe('agent');
    expect(urls).toEqual([
      'https://fake.moltnet.test/oauth2/token',
      'https://fake.moltnet.test/agents/whoami',
    ]);
  });

  it('authenticates with a static agent key without an OAuth2 exchange', async () => {
    const requests: Request[] = [];
    vi.stubGlobal(
      'fetch',
      async (input: string | URL | Request, init?: RequestInit) => {
        const request = new Request(input, init);
        requests.push(request);
        return Response.json({
          subjectType: 'agent',
          identityId: '11111111-1111-4111-8111-111111111111',
          currentTeamId: null,
        });
      },
    );

    const agent = await connect({
      apiUrl: 'https://fake.moltnet.test',
      agentKey: '  opaque-agent-key  ',
      retry: false,
    });
    await agent.agents.whoami();

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe('https://fake.moltnet.test/agents/whoami');
    expect(requests[0]?.headers.get('Authorization')).toBe(
      'Bearer opaque-agent-key',
    );
  });

  it.each([
    { agentKey: 'opaque-agent-key' },
    { clientId: 'client-id', clientSecret: 'client-secret' },
  ])(
    'sends agent credentials only through bearer authentication: %j',
    async (auth) => {
      const requests: Request[] = [];
      vi.stubGlobal(
        'fetch',
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const request = new Request(input, init);
          if (request.url.endsWith('/oauth2/token')) {
            return Response.json({
              access_token: 'oauth-token',
              expires_in: 3_600,
            });
          }
          requests.push(request);
          return Response.json({ subjectType: 'agent' });
        },
      );
      const agent = await connect({
        apiUrl: 'https://fake.moltnet.test',
        ...auth,
        retry: false,
      });

      await agent.agents.whoami();
      await agent.runtimeSessions.renew(
        'store',
        {
          taskId: 'task',
          attemptN: 1,
          leaseId: 'lease',
          executorFingerprint: 'fingerprint',
          writerToken: 'writer',
        },
        { teamId: 'team' },
      );

      expect(requests).toHaveLength(2);
      for (const request of requests) {
        expect(request.headers.get('Authorization')).toBe(
          `Bearer ${'agentKey' in auth ? auth.agentKey : 'oauth-token'}`,
        );
        expect(request.headers.has('X-Moltnet-Session-Token')).toBe(false);
        expect(request.headers.has('Cookie')).toBe(false);
      }
    },
  );

  it.each([
    { agentKey: 'opaque-agent-key' },
    { clientId: 'client-id', clientSecret: 'client-secret' },
  ])('applies the connection signal to $agentKey requests', async (auth) => {
    const signals: AbortSignal[] = [];
    vi.stubGlobal(
      'fetch',
      async (input: string | URL | Request, init?: RequestInit) => {
        const request = new Request(input, init);
        signals.push(request.signal);
        if (request.url.endsWith('/oauth2/token')) {
          return Response.json({ access_token: 'token', expires_in: 3_600 });
        }
        return Response.json({
          subjectType: 'agent',
          identityId: '11111111-1111-4111-8111-111111111111',
          currentTeamId: null,
        });
      },
    );
    const controller = new AbortController();
    const agent = await connect({
      apiUrl: 'https://fake.moltnet.test',
      ...auth,
      signal: controller.signal,
      retry: false,
    });

    await agent.agents.whoami();
    controller.abort();

    expect(signals.length).toBeGreaterThan(0);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it.each([
    { agentKey: 'opaque-agent-key' },
    { clientId: 'client-id', clientSecret: 'client-secret' },
  ])('refuses to send credentials over remote plaintext HTTP', async (auth) => {
    await expect(
      connect({
        apiUrl: 'http://remote.example.test',
        ...auth,
      }),
    ).rejects.toThrow(/Refusing to send credentials/);
  });
});
