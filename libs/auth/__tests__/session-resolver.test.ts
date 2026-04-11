import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createSessionResolver,
  type SessionResolver,
} from '../src/session-resolver.js';
import type { HumanAuthContext } from '../src/types.js';

const VALID_SESSION_TOKEN = 'ory_st_valid_session_token_123';
const VALID_COOKIE_HEADER =
  'csrf_token=abc; ory_kratos_session=MTczMjE5ODk2MHxEdjBGQUFFR01; theme=dark';
const VALID_IDENTITY_ID = '550e8400-e29b-41d4-a716-446655440000';

function createMockFrontendApi() {
  return {
    toSession: vi.fn(),
  };
}

function createValidSessionResponse() {
  return {
    id: 'session-uuid',
    active: true,
    identity: {
      id: VALID_IDENTITY_ID,
      schema_id: 'moltnet_human',
      traits: {
        email: 'test@example.com',
        username: 'testuser',
      },
    },
  };
}

describe('createSessionResolver', () => {
  let mockFrontendApi: ReturnType<typeof createMockFrontendApi>;
  let resolver: SessionResolver;

  beforeEach(() => {
    mockFrontendApi = createMockFrontendApi();
    resolver = createSessionResolver(mockFrontendApi as never);
  });

  it('returns HumanAuthContext for a valid session token', async () => {
    mockFrontendApi.toSession.mockResolvedValue(createValidSessionResponse());

    const result = await resolver.resolveSession({
      sessionToken: VALID_SESSION_TOKEN,
    });

    expect(result).toEqual({
      subjectType: 'human',
      identityId: VALID_IDENTITY_ID,
      clientId: null,
      scopes: ['diary:read', 'diary:write', 'human:profile', 'team:read'],
      currentTeamId: null,
    } satisfies HumanAuthContext);

    expect(mockFrontendApi.toSession).toHaveBeenCalledWith({
      xSessionToken: VALID_SESSION_TOKEN,
    });
  });

  it('returns HumanAuthContext for a valid browser cookie', async () => {
    mockFrontendApi.toSession.mockResolvedValue(createValidSessionResponse());

    const result = await resolver.resolveSession({
      cookie: VALID_COOKIE_HEADER,
    });

    expect(result).toMatchObject({
      subjectType: 'human',
      identityId: VALID_IDENTITY_ID,
    });
    // Raw cookie header is forwarded unchanged — Kratos extracts the session
    // cookie itself. We must NOT touch xSessionToken on this path.
    expect(mockFrontendApi.toSession).toHaveBeenCalledWith({
      cookie: VALID_COOKIE_HEADER,
    });
  });

  it('prefers session token over cookie when both are provided', async () => {
    mockFrontendApi.toSession.mockResolvedValue(createValidSessionResponse());

    await resolver.resolveSession({
      sessionToken: VALID_SESSION_TOKEN,
      cookie: VALID_COOKIE_HEADER,
    });

    expect(mockFrontendApi.toSession).toHaveBeenCalledWith({
      xSessionToken: VALID_SESSION_TOKEN,
    });
    expect(mockFrontendApi.toSession).not.toHaveBeenCalledWith(
      expect.objectContaining({ cookie: expect.any(String) }),
    );
  });

  it('returns null when neither sessionToken nor cookie is provided', async () => {
    const result = await resolver.resolveSession({});

    expect(result).toBeNull();
    expect(mockFrontendApi.toSession).not.toHaveBeenCalled();
  });

  it('treats empty-string sessionToken as absent and does not hit Kratos', async () => {
    // Regression guard: a client that sends `X-Moltnet-Session-Token: `
    // (header present but value empty) must not trigger a useless round-trip
    // to Kratos with `xSessionToken: ""`.
    const result = await resolver.resolveSession({ sessionToken: '' });

    expect(result).toBeNull();
    expect(mockFrontendApi.toSession).not.toHaveBeenCalled();
  });

  it('treats whitespace-only sessionToken as absent', async () => {
    const result = await resolver.resolveSession({ sessionToken: '   ' });

    expect(result).toBeNull();
    expect(mockFrontendApi.toSession).not.toHaveBeenCalled();
  });

  it('treats empty-string cookie as absent', async () => {
    const result = await resolver.resolveSession({ cookie: '' });

    expect(result).toBeNull();
    expect(mockFrontendApi.toSession).not.toHaveBeenCalled();
  });

  it('falls back to cookie when sessionToken is empty string', async () => {
    mockFrontendApi.toSession.mockResolvedValue(createValidSessionResponse());

    const result = await resolver.resolveSession({
      sessionToken: '',
      cookie: VALID_COOKIE_HEADER,
    });

    expect(result).toMatchObject({ subjectType: 'human' });
    expect(mockFrontendApi.toSession).toHaveBeenCalledWith({
      cookie: VALID_COOKIE_HEADER,
    });
  });

  it('calls the API on every invocation (no caching)', async () => {
    mockFrontendApi.toSession.mockResolvedValue(createValidSessionResponse());

    await resolver.resolveSession({ sessionToken: VALID_SESSION_TOKEN });
    await resolver.resolveSession({ sessionToken: VALID_SESSION_TOKEN });

    expect(mockFrontendApi.toSession).toHaveBeenCalledTimes(2);
  });

  it('returns null for an invalid session token', async () => {
    mockFrontendApi.toSession.mockRejectedValue(new Error('Session not found'));

    const result = await resolver.resolveSession({
      sessionToken: 'invalid-token',
    });

    expect(result).toBeNull();
  });

  it('returns null for an invalid cookie', async () => {
    mockFrontendApi.toSession.mockRejectedValue(new Error('Session not found'));

    const result = await resolver.resolveSession({
      cookie: 'ory_kratos_session=garbage',
    });

    expect(result).toBeNull();
  });

  it('returns null when identity is missing from session', async () => {
    mockFrontendApi.toSession.mockResolvedValue({
      id: 'session-uuid',
      active: true,
      identity: null,
    });

    const result = await resolver.resolveSession({
      sessionToken: VALID_SESSION_TOKEN,
    });

    expect(result).toBeNull();
  });

  it('returns null when identity has no id', async () => {
    mockFrontendApi.toSession.mockResolvedValue({
      id: 'session-uuid',
      active: true,
      identity: { schema_id: 'moltnet_human', traits: {} },
    });

    const result = await resolver.resolveSession({
      sessionToken: VALID_SESSION_TOKEN,
    });

    expect(result).toBeNull();
  });

  it('uses custom scopes when configured', async () => {
    const customResolver = createSessionResolver(mockFrontendApi as never, {
      scopes: ['custom:scope'],
    });

    mockFrontendApi.toSession.mockResolvedValue(createValidSessionResponse());

    const result = await customResolver.resolveSession({
      sessionToken: VALID_SESSION_TOKEN,
    });

    expect(result?.scopes).toEqual(['custom:scope']);
  });

  describe('Kratos error observability', () => {
    it('stays quiet on 401 (expected expired/invalid session)', async () => {
      const warn = vi.fn();
      const loggingResolver = createSessionResolver(mockFrontendApi as never, {
        logger: { warn },
      });
      const err = Object.assign(new Error('Unauthorized'), { status: 401 });
      mockFrontendApi.toSession.mockRejectedValue(err);

      const result = await loggingResolver.resolveSession({
        sessionToken: VALID_SESSION_TOKEN,
      });

      expect(result).toBeNull();
      expect(warn).not.toHaveBeenCalled();
    });

    it('warns on 503 so a degraded Kratos is observable', async () => {
      const warn = vi.fn();
      const loggingResolver = createSessionResolver(mockFrontendApi as never, {
        logger: { warn },
      });
      const err = Object.assign(new Error('Service Unavailable'), {
        status: 503,
      });
      mockFrontendApi.toSession.mockRejectedValue(err);

      const result = await loggingResolver.resolveSession({
        sessionToken: VALID_SESSION_TOKEN,
      });

      expect(result).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ status: 503 }),
        expect.stringContaining('Kratos toSession error'),
      );
    });

    it('warns on network error with no status', async () => {
      const warn = vi.fn();
      const loggingResolver = createSessionResolver(mockFrontendApi as never, {
        logger: { warn },
      });
      mockFrontendApi.toSession.mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await loggingResolver.resolveSession({
        sessionToken: VALID_SESSION_TOKEN,
      });

      expect(result).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('no-ops when no logger is configured (default)', async () => {
      mockFrontendApi.toSession.mockRejectedValue(
        Object.assign(new Error('boom'), { status: 500 }),
      );

      // Default resolver has no logger — this must not throw.
      const result = await resolver.resolveSession({
        sessionToken: VALID_SESSION_TOKEN,
      });

      expect(result).toBeNull();
    });
  });
});
