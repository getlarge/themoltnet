import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createSessionResolver,
  type SessionResolver,
} from '../src/session-resolver.js';
import type { HumanAuthContext } from '../src/types.js';

const VALID_SESSION_TOKEN = 'ory_st_valid_session_token_123';
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
    resolver = createSessionResolver(mockFrontendApi as never, {
      cacheTtlMs: 1000,
      cacheMaxSize: 10,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns HumanAuthContext for a valid session', async () => {
    mockFrontendApi.toSession.mockResolvedValue(createValidSessionResponse());

    const result = await resolver.resolveSession(VALID_SESSION_TOKEN);

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

  it('returns null for an invalid session', async () => {
    mockFrontendApi.toSession.mockRejectedValue(new Error('Session not found'));

    const result = await resolver.resolveSession('invalid-token');

    expect(result).toBeNull();
  });

  it('returns null when identity is missing from session', async () => {
    mockFrontendApi.toSession.mockResolvedValue({
      id: 'session-uuid',
      active: true,
      identity: null,
    });

    const result = await resolver.resolveSession(VALID_SESSION_TOKEN);

    expect(result).toBeNull();
  });

  it('returns null when identity has no id', async () => {
    mockFrontendApi.toSession.mockResolvedValue({
      id: 'session-uuid',
      active: true,
      identity: { schema_id: 'moltnet_human', traits: {} },
    });

    const result = await resolver.resolveSession(VALID_SESSION_TOKEN);

    expect(result).toBeNull();
  });

  it('caches valid sessions (second call does not hit API)', async () => {
    mockFrontendApi.toSession.mockResolvedValue(createValidSessionResponse());

    const first = await resolver.resolveSession(VALID_SESSION_TOKEN);
    const second = await resolver.resolveSession(VALID_SESSION_TOKEN);

    expect(first).toEqual(second);
    expect(mockFrontendApi.toSession).toHaveBeenCalledTimes(1);
  });

  it('re-fetches after cache TTL expires', async () => {
    vi.useFakeTimers();

    mockFrontendApi.toSession.mockResolvedValue(createValidSessionResponse());

    await resolver.resolveSession(VALID_SESSION_TOKEN);
    expect(mockFrontendApi.toSession).toHaveBeenCalledTimes(1);

    // Advance past cache TTL
    vi.advanceTimersByTime(1500);

    await resolver.resolveSession(VALID_SESSION_TOKEN);
    expect(mockFrontendApi.toSession).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it('evicts oldest entry when cache is full', async () => {
    // Cache max size is 10
    for (let i = 0; i < 10; i++) {
      mockFrontendApi.toSession.mockResolvedValueOnce({
        ...createValidSessionResponse(),
        identity: {
          ...createValidSessionResponse().identity,
          id: `identity-${i}`,
        },
      });
      await resolver.resolveSession(`token-${i}`);
    }

    expect(mockFrontendApi.toSession).toHaveBeenCalledTimes(10);

    // Add one more — should evict token-0
    mockFrontendApi.toSession.mockResolvedValueOnce(
      createValidSessionResponse(),
    );
    await resolver.resolveSession('token-new');
    expect(mockFrontendApi.toSession).toHaveBeenCalledTimes(11);

    // token-0 should be evicted — fetching it again should call the API
    mockFrontendApi.toSession.mockResolvedValueOnce({
      ...createValidSessionResponse(),
      identity: {
        ...createValidSessionResponse().identity,
        id: 'identity-0',
      },
    });
    await resolver.resolveSession('token-0');
    expect(mockFrontendApi.toSession).toHaveBeenCalledTimes(12);
  });

  it('removes stale cache entry on API failure', async () => {
    mockFrontendApi.toSession.mockResolvedValueOnce(
      createValidSessionResponse(),
    );

    // Cache it
    await resolver.resolveSession(VALID_SESSION_TOKEN);
    expect(mockFrontendApi.toSession).toHaveBeenCalledTimes(1);

    // Simulate cache entry still present but we force a re-fetch by
    // creating a new resolver with 0 TTL
    const shortResolver = createSessionResolver(mockFrontendApi as never, {
      cacheTtlMs: 0,
    });

    mockFrontendApi.toSession.mockResolvedValueOnce(
      createValidSessionResponse(),
    );
    await shortResolver.resolveSession(VALID_SESSION_TOKEN);

    // Now the session expires
    mockFrontendApi.toSession.mockRejectedValueOnce(new Error('expired'));
    const result = await shortResolver.resolveSession(VALID_SESSION_TOKEN);
    expect(result).toBeNull();
  });

  it('uses custom scopes when configured', async () => {
    const customResolver = createSessionResolver(mockFrontendApi as never, {
      scopes: ['custom:scope'],
    });

    mockFrontendApi.toSession.mockResolvedValue(createValidSessionResponse());

    const result = await customResolver.resolveSession(VALID_SESSION_TOKEN);

    expect(result?.scopes).toEqual(['custom:scope']);
  });
});
