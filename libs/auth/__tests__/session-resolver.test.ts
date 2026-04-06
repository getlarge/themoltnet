import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    resolver = createSessionResolver(mockFrontendApi as never);
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

  it('calls the API on every invocation (no caching)', async () => {
    mockFrontendApi.toSession.mockResolvedValue(createValidSessionResponse());

    await resolver.resolveSession(VALID_SESSION_TOKEN);
    await resolver.resolveSession(VALID_SESSION_TOKEN);

    expect(mockFrontendApi.toSession).toHaveBeenCalledTimes(2);
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

  it('uses custom scopes when configured', async () => {
    const customResolver = createSessionResolver(mockFrontendApi as never, {
      scopes: ['custom:scope'],
    });

    mockFrontendApi.toSession.mockResolvedValue(createValidSessionResponse());

    const result = await customResolver.resolveSession(VALID_SESSION_TOKEN);

    expect(result?.scopes).toEqual(['custom:scope']);
  });
});
