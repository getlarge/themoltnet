import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { KetoNamespace } from '../src/keto-constants.js';
import {
  authPlugin,
  optionalAuth,
  requireAuth,
  requireScopes,
} from '../src/plugin.js';
import type { AuthContext, HumanAuthContext } from '../src/types.js';

const VALID_TOKEN = 'ory_at_valid_token_123';
const VALID_AUTH_CONTEXT: AuthContext = {
  subjectType: 'agent',
  identityId: '550e8400-e29b-41d4-a716-446655440000',
  publicKey: 'ed25519:AAAA+/bbbb==',
  fingerprint: 'A1B2-C3D4-E5F6-07A8',
  clientId: 'hydra-client-uuid',
  scopes: ['diary:read', 'diary:write', 'agent:profile'],
  currentTeamId: null,
};

const VALID_SESSION_CONTEXT: HumanAuthContext = {
  subjectType: 'human',
  identityId: '660e8400-e29b-41d4-a716-446655440001',
  clientId: null,
  scopes: ['diary:read', 'diary:write', 'human:profile', 'team:read'],
  currentTeamId: null,
};

function createMockSessionResolver() {
  return {
    resolveSession: vi.fn(),
  };
}

function createMockTokenValidator() {
  return {
    introspect: vi.fn(),
    resolveAuthContext: vi.fn(),
  };
}

function createMockPermissionChecker() {
  return {
    canViewEntry: vi.fn(),
    canEditEntry: vi.fn(),
    canDeleteEntry: vi.fn(),
    canReadDiary: vi.fn(),
    canWriteDiary: vi.fn(),
    canManageDiary: vi.fn(),
    canAccessTeam: vi.fn().mockResolvedValue(true),
  };
}

function createMockRelationshipWriter() {
  return {
    grantEntryParent: vi.fn(),
    registerAgent: vi.fn(),
    removeEntryRelations: vi.fn(),
    grantDiaryTeam: vi.fn(),
    removeDiaryTeam: vi.fn(),
    removeDiaryRelations: vi.fn(),
  };
}

describe('authPlugin', () => {
  let app: FastifyInstance;
  let mockTokenValidator: ReturnType<typeof createMockTokenValidator>;
  let mockPermissionChecker: ReturnType<typeof createMockPermissionChecker>;
  let mockRelationshipWriter: ReturnType<typeof createMockRelationshipWriter>;

  beforeEach(async () => {
    mockTokenValidator = createMockTokenValidator();
    mockPermissionChecker = createMockPermissionChecker();
    mockRelationshipWriter = createMockRelationshipWriter();

    app = Fastify();
    await app.register(authPlugin, {
      tokenValidator: mockTokenValidator,
      permissionChecker: mockPermissionChecker,
      relationshipWriter: mockRelationshipWriter,
      teamResolver: { findPersonalTeamId: vi.fn().mockResolvedValue(null) },
    } as never);
  });

  it('decorates request with authContext (null by default)', async () => {
    app.get('/test', async (request) => {
      return { authContext: request.authContext };
    });

    const response = await app.inject({
      method: 'GET',
      url: '/test',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ authContext: null });
  });

  it('decorates instance with tokenValidator', async () => {
    app.get('/test', async (request) => {
      return { hasValidator: !!request.server.tokenValidator };
    });

    const response = await app.inject({
      method: 'GET',
      url: '/test',
    });

    expect(response.json()).toEqual({ hasValidator: true });
  });

  it('decorates instance with permissionChecker', async () => {
    app.get('/test', async (request) => {
      return { hasChecker: !!request.server.permissionChecker };
    });

    const response = await app.inject({
      method: 'GET',
      url: '/test',
    });

    expect(response.json()).toEqual({ hasChecker: true });
  });

  it('decorates instance with relationshipWriter', async () => {
    app.get('/test', async (request) => {
      return { hasWriter: !!request.server.relationshipWriter };
    });

    const response = await app.inject({
      method: 'GET',
      url: '/test',
    });

    expect(response.json()).toEqual({ hasWriter: true });
  });
});

describe('requireAuth preHandler', () => {
  let app: FastifyInstance;
  let mockTokenValidator: ReturnType<typeof createMockTokenValidator>;
  let mockPermissionChecker: ReturnType<typeof createMockPermissionChecker>;
  let mockRelationshipWriter: ReturnType<typeof createMockRelationshipWriter>;

  beforeEach(async () => {
    mockTokenValidator = createMockTokenValidator();
    mockPermissionChecker = createMockPermissionChecker();
    mockRelationshipWriter = createMockRelationshipWriter();

    app = Fastify();
    await app.register(authPlugin, {
      tokenValidator: mockTokenValidator,
      permissionChecker: mockPermissionChecker,
      relationshipWriter: mockRelationshipWriter,
      teamResolver: { findPersonalTeamId: vi.fn().mockResolvedValue(null) },
    } as never);
  });

  it('sets authContext on request when token is valid', async () => {
    mockTokenValidator.resolveAuthContext.mockResolvedValue(VALID_AUTH_CONTEXT);

    app.get('/protected', { preHandler: [requireAuth] }, async (request) => {
      return { authContext: request.authContext };
    });

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().authContext).toEqual(VALID_AUTH_CONTEXT);
    expect(mockTokenValidator.resolveAuthContext).toHaveBeenCalledWith(
      VALID_TOKEN,
    );
  });

  it('returns 401 when no authorization header', async () => {
    app.get('/protected', { preHandler: [requireAuth] }, async () => {
      return { ok: true };
    });

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      code: 'UNAUTHORIZED',
      error: 'Unauthorized',
      message: 'Missing authorization header',
      statusCode: 401,
    });
  });

  it('returns 401 when authorization header is not Bearer', async () => {
    app.get('/protected', { preHandler: [requireAuth] }, async () => {
      return { ok: true };
    });

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Basic dXNlcjpwYXNz' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      code: 'UNAUTHORIZED',
      error: 'Unauthorized',
      message: 'Invalid authorization scheme',
      statusCode: 401,
    });
  });

  it('returns 401 when token resolution fails', async () => {
    mockTokenValidator.resolveAuthContext.mockResolvedValue(null);

    app.get('/protected', { preHandler: [requireAuth] }, async () => {
      return { ok: true };
    });

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      code: 'UNAUTHORIZED',
      error: 'Unauthorized',
      message: 'Invalid or expired token',
      statusCode: 401,
    });
  });

  it('returns 401 when Bearer token is empty', async () => {
    app.get('/protected', { preHandler: [requireAuth] }, async () => {
      return { ok: true };
    });

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer ' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      code: 'UNAUTHORIZED',
      error: 'Unauthorized',
      message: 'Missing authorization header',
      statusCode: 401,
    });
  });
});

describe('optionalAuth preHandler', () => {
  let app: FastifyInstance;
  let mockTokenValidator: ReturnType<typeof createMockTokenValidator>;
  let mockPermissionChecker: ReturnType<typeof createMockPermissionChecker>;
  let mockRelationshipWriter: ReturnType<typeof createMockRelationshipWriter>;

  beforeEach(async () => {
    mockTokenValidator = createMockTokenValidator();
    mockPermissionChecker = createMockPermissionChecker();
    mockRelationshipWriter = createMockRelationshipWriter();

    app = Fastify();
    await app.register(authPlugin, {
      tokenValidator: mockTokenValidator,
      permissionChecker: mockPermissionChecker,
      relationshipWriter: mockRelationshipWriter,
      teamResolver: { findPersonalTeamId: vi.fn().mockResolvedValue(null) },
    } as never);
  });

  it('sets authContext when valid token provided', async () => {
    mockTokenValidator.resolveAuthContext.mockResolvedValue(VALID_AUTH_CONTEXT);

    app.get('/optional', { preHandler: [optionalAuth] }, async (request) => {
      return { authContext: request.authContext };
    });

    const response = await app.inject({
      method: 'GET',
      url: '/optional',
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().authContext).toEqual(VALID_AUTH_CONTEXT);
  });

  it('resolves team context for session-authenticated requests', async () => {
    const sessionResolver = createMockSessionResolver();
    sessionResolver.resolveSession.mockResolvedValue({
      ...VALID_SESSION_CONTEXT,
    });

    app = Fastify();
    await app.register(authPlugin, {
      tokenValidator: mockTokenValidator,
      permissionChecker: mockPermissionChecker,
      relationshipWriter: mockRelationshipWriter,
      teamResolver: { findPersonalTeamId: vi.fn().mockResolvedValue(null) },
      sessionResolver,
    } as never);

    app.get('/optional', { preHandler: [optionalAuth] }, async (request) => {
      return { authContext: request.authContext };
    });

    const response = await app.inject({
      method: 'GET',
      url: '/optional',
      headers: {
        'x-moltnet-session-token': 'ory_st_valid_session_token_123',
        'x-moltnet-team-id': 'team-123',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().authContext).toEqual({
      ...VALID_SESSION_CONTEXT,
      currentTeamId: 'team-123',
    });
    expect(mockPermissionChecker.canAccessTeam).toHaveBeenCalledWith(
      'team-123',
      VALID_SESSION_CONTEXT.identityId,
      KetoNamespace.Human,
    );
  });

  it('continues with null authContext when no token', async () => {
    app.get('/optional', { preHandler: [optionalAuth] }, async (request) => {
      return { authContext: request.authContext };
    });

    const response = await app.inject({
      method: 'GET',
      url: '/optional',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().authContext).toBeNull();
  });

  it('continues with null authContext when token is invalid', async () => {
    mockTokenValidator.resolveAuthContext.mockResolvedValue(null);

    app.get('/optional', { preHandler: [optionalAuth] }, async (request) => {
      return { authContext: request.authContext };
    });

    const response = await app.inject({
      method: 'GET',
      url: '/optional',
      headers: { authorization: `Bearer invalid_token` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().authContext).toBeNull();
  });
});

describe('requireScopes preHandler', () => {
  let app: FastifyInstance;
  let mockTokenValidator: ReturnType<typeof createMockTokenValidator>;
  let mockPermissionChecker: ReturnType<typeof createMockPermissionChecker>;
  let mockRelationshipWriter: ReturnType<typeof createMockRelationshipWriter>;

  beforeEach(async () => {
    mockTokenValidator = createMockTokenValidator();
    mockPermissionChecker = createMockPermissionChecker();
    mockRelationshipWriter = createMockRelationshipWriter();

    app = Fastify();
    await app.register(authPlugin, {
      tokenValidator: mockTokenValidator,
      permissionChecker: mockPermissionChecker,
      relationshipWriter: mockRelationshipWriter,
      teamResolver: { findPersonalTeamId: vi.fn().mockResolvedValue(null) },
    } as never);
  });

  it('allows request when all required scopes are present', async () => {
    mockTokenValidator.resolveAuthContext.mockResolvedValue(VALID_AUTH_CONTEXT);

    app.get(
      '/scoped',
      { preHandler: [requireAuth, requireScopes(['diary:read'])] },
      async () => {
        return { ok: true };
      },
    );

    const response = await app.inject({
      method: 'GET',
      url: '/scoped',
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(response.statusCode).toBe(200);
  });

  it('allows request with multiple required scopes', async () => {
    mockTokenValidator.resolveAuthContext.mockResolvedValue(VALID_AUTH_CONTEXT);

    app.get(
      '/scoped',
      {
        preHandler: [requireAuth, requireScopes(['diary:read', 'diary:write'])],
      },
      async () => {
        return { ok: true };
      },
    );

    const response = await app.inject({
      method: 'GET',
      url: '/scoped',
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(response.statusCode).toBe(200);
  });

  it('returns 403 when a required scope is missing', async () => {
    mockTokenValidator.resolveAuthContext.mockResolvedValue(VALID_AUTH_CONTEXT);

    app.get(
      '/scoped',
      {
        preHandler: [requireAuth, requireScopes(['diary:delete'])],
      },
      async () => {
        return { ok: true };
      },
    );

    const response = await app.inject({
      method: 'GET',
      url: '/scoped',
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      code: 'FORBIDDEN',
      error: 'Forbidden',
      message: 'Missing required scope: diary:delete',
      statusCode: 403,
    });
  });

  it('returns 401 when authContext is null (no auth)', async () => {
    app.get(
      '/scoped',
      { preHandler: [requireScopes(['diary:read'])] },
      async () => {
        return { ok: true };
      },
    );

    const response = await app.inject({
      method: 'GET',
      url: '/scoped',
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      code: 'UNAUTHORIZED',
      error: 'Unauthorized',
      message: 'Authentication required',
      statusCode: 401,
    });
  });
});

describe('requireAuth with sessionResolver', () => {
  let app: FastifyInstance;
  let mockTokenValidator: ReturnType<typeof createMockTokenValidator>;
  let mockPermissionChecker: ReturnType<typeof createMockPermissionChecker>;
  let mockRelationshipWriter: ReturnType<typeof createMockRelationshipWriter>;
  let mockSessionResolver: ReturnType<typeof createMockSessionResolver>;

  beforeEach(async () => {
    mockTokenValidator = createMockTokenValidator();
    mockPermissionChecker = createMockPermissionChecker();
    mockRelationshipWriter = createMockRelationshipWriter();
    mockSessionResolver = createMockSessionResolver();

    app = Fastify();
    await app.register(authPlugin, {
      tokenValidator: mockTokenValidator,
      permissionChecker: mockPermissionChecker,
      relationshipWriter: mockRelationshipWriter,
      teamResolver: { findPersonalTeamId: vi.fn().mockResolvedValue(null) },
      sessionResolver: mockSessionResolver,
    } as never);
  });

  it('sets authContext from session token when valid', async () => {
    mockSessionResolver.resolveSession.mockResolvedValue(VALID_SESSION_CONTEXT);

    app.get('/protected', { preHandler: [requireAuth] }, async (request) => {
      return { authContext: request.authContext };
    });

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { 'x-moltnet-session-token': 'valid-session-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().authContext).toEqual(VALID_SESSION_CONTEXT);
    expect(mockSessionResolver.resolveSession).toHaveBeenCalledWith(
      'valid-session-token',
    );
    expect(mockTokenValidator.resolveAuthContext).not.toHaveBeenCalled();
  });

  it('falls through to Bearer when session token is invalid', async () => {
    mockSessionResolver.resolveSession.mockResolvedValue(null);
    mockTokenValidator.resolveAuthContext.mockResolvedValue(VALID_AUTH_CONTEXT);

    app.get('/protected', { preHandler: [requireAuth] }, async (request) => {
      return { authContext: request.authContext };
    });

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: {
        'x-moltnet-session-token': 'invalid-session',
        authorization: `Bearer ${VALID_TOKEN}`,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().authContext).toEqual(VALID_AUTH_CONTEXT);
  });

  it('authenticates via session when no Bearer present', async () => {
    mockSessionResolver.resolveSession.mockResolvedValue(VALID_SESSION_CONTEXT);

    app.get('/protected', { preHandler: [requireAuth] }, async (request) => {
      return { authContext: request.authContext };
    });

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { 'x-moltnet-session-token': 'valid-session-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().authContext.subjectType).toBe('human');
  });

  it('returns 401 when session is invalid and no Bearer present', async () => {
    mockSessionResolver.resolveSession.mockResolvedValue(null);

    app.get('/protected', { preHandler: [requireAuth] }, async () => {
      return { ok: true };
    });

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { 'x-moltnet-session-token': 'invalid-session' },
    });

    expect(response.statusCode).toBe(401);
  });
});

describe('requireAuth without sessionResolver', () => {
  let app: FastifyInstance;
  let mockTokenValidator: ReturnType<typeof createMockTokenValidator>;
  let mockPermissionChecker: ReturnType<typeof createMockPermissionChecker>;
  let mockRelationshipWriter: ReturnType<typeof createMockRelationshipWriter>;

  beforeEach(async () => {
    mockTokenValidator = createMockTokenValidator();
    mockPermissionChecker = createMockPermissionChecker();
    mockRelationshipWriter = createMockRelationshipWriter();

    app = Fastify();
    await app.register(authPlugin, {
      tokenValidator: mockTokenValidator,
      permissionChecker: mockPermissionChecker,
      relationshipWriter: mockRelationshipWriter,
      teamResolver: { findPersonalTeamId: vi.fn().mockResolvedValue(null) },
    } as never);
  });

  it('ignores X-Session-Token header when no sessionResolver configured', async () => {
    mockTokenValidator.resolveAuthContext.mockResolvedValue(VALID_AUTH_CONTEXT);

    app.get('/protected', { preHandler: [requireAuth] }, async (request) => {
      return { authContext: request.authContext };
    });

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: {
        'x-moltnet-session-token': 'some-session-token',
        authorization: `Bearer ${VALID_TOKEN}`,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().authContext).toEqual(VALID_AUTH_CONTEXT);
  });
});

describe('optionalAuth with sessionResolver', () => {
  let app: FastifyInstance;
  let mockTokenValidator: ReturnType<typeof createMockTokenValidator>;
  let mockPermissionChecker: ReturnType<typeof createMockPermissionChecker>;
  let mockRelationshipWriter: ReturnType<typeof createMockRelationshipWriter>;
  let mockSessionResolver: ReturnType<typeof createMockSessionResolver>;

  beforeEach(async () => {
    mockTokenValidator = createMockTokenValidator();
    mockPermissionChecker = createMockPermissionChecker();
    mockRelationshipWriter = createMockRelationshipWriter();
    mockSessionResolver = createMockSessionResolver();

    app = Fastify();
    await app.register(authPlugin, {
      tokenValidator: mockTokenValidator,
      permissionChecker: mockPermissionChecker,
      relationshipWriter: mockRelationshipWriter,
      teamResolver: { findPersonalTeamId: vi.fn().mockResolvedValue(null) },
      sessionResolver: mockSessionResolver,
    } as never);
  });

  it('sets authContext from session token', async () => {
    mockSessionResolver.resolveSession.mockResolvedValue(VALID_SESSION_CONTEXT);

    app.get('/optional', { preHandler: [optionalAuth] }, async (request) => {
      return { authContext: request.authContext };
    });

    const response = await app.inject({
      method: 'GET',
      url: '/optional',
      headers: { 'x-moltnet-session-token': 'valid-session-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().authContext).toEqual(VALID_SESSION_CONTEXT);
    expect(mockTokenValidator.resolveAuthContext).not.toHaveBeenCalled();
  });

  it('falls back to Bearer when session is invalid', async () => {
    mockSessionResolver.resolveSession.mockResolvedValue(null);
    mockTokenValidator.resolveAuthContext.mockResolvedValue(VALID_AUTH_CONTEXT);

    app.get('/optional', { preHandler: [optionalAuth] }, async (request) => {
      return { authContext: request.authContext };
    });

    const response = await app.inject({
      method: 'GET',
      url: '/optional',
      headers: {
        'x-moltnet-session-token': 'invalid-session',
        authorization: `Bearer ${VALID_TOKEN}`,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().authContext).toEqual(VALID_AUTH_CONTEXT);
  });

  it('returns null authContext when session is invalid and no Bearer', async () => {
    mockSessionResolver.resolveSession.mockResolvedValue(null);

    app.get('/optional', { preHandler: [optionalAuth] }, async (request) => {
      return { authContext: request.authContext };
    });

    const response = await app.inject({
      method: 'GET',
      url: '/optional',
      headers: { 'x-moltnet-session-token': 'invalid-session' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().authContext).toBeNull();
  });
});
