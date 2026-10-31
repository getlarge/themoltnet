import { afterEach, describe, expect, it, vi } from 'vitest';

import { connect } from '../src/connect.js';
import { AuthenticationError } from '../src/errors.js';

// Unlike connect.test.ts (which mocks createClient/createAgent), this suite
// wires the REAL connect() → createClient → createAgent → global fetch, so it
// proves the shipped auth path actually turns the agent key into an
// `Authorization: Bearer <key>` header without any OAuth2 round-trip.

function requestFrom(
  input: RequestInfo | URL,
  init?: RequestInit,
): { url: string; authorization: string | null } {
  const request = input instanceof Request ? input : new Request(input, init);
  return {
    url: request.url,
    authorization: request.headers.get('Authorization'),
  };
}

describe('connect agent-key transport', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends Authorization: Bearer <key> and never calls /oauth2/token', async () => {
    const calls: Array<{ url: string; authorization: string | null }> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push(requestFrom(input, init));
        return new Response(
          JSON.stringify({ identityId: 'id-1', subjectType: 'agent' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    );

    const agent = await connect({
      agentKey: 'opaque-key',
      apiUrl: 'https://api.test',
      retry: false,
    });
    await agent.agents.whoami();

    expect(calls.some((c) => c.url.includes('/oauth2/token'))).toBe(false);
    const whoami = calls.find((c) => c.url.includes('/agents/whoami'));
    expect(whoami?.authorization).toBe('Bearer opaque-key');
  });

  it('throws an AuthenticationError on a rejected key (401), never leaking it', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ code: 'UNAUTHORIZED' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const agent = await connect({
      agentKey: 'super-secret-key',
      apiUrl: 'https://api.test',
      retry: false,
    });

    const err = await agent.agents.whoami().catch((e) => e);
    expect(err).toBeInstanceOf(AuthenticationError);
    expect(String(err)).not.toContain('super-secret-key');
  });
});
