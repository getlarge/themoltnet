import {
  enterRequestContext,
  getRequestContextFields,
} from '@moltnet/observability';
import Fastify, { type FastifyInstance } from 'fastify';
import { pino } from 'pino';
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

  it('enriches request.log + ALS context after authenticating', async () => {
    // Regression: production logs were missing identityId because the
    // global request-context plugin's preHandler ran before the route-
    // scoped requireAuth, so authContext was still null when it tried
    // to enrich. The fix moves enrichment into requireAuth itself.
    mockTokenValidator.resolveAuthContext.mockResolvedValue(VALID_AUTH_CONTEXT);

    // Replace the bare app with one that has a real pino instance so
    // request.log child bindings produce inspectable log records.
    await app.close();
    const records: Record<string, unknown>[] = [];
    const logger = pino(
      { level: 'info' },
      {
        write(chunk: string) {
          for (const line of chunk.split('\n')) {
            if (!line) continue;
            records.push(JSON.parse(line) as Record<string, unknown>);
          }
        },
      },
    );
    app = Fastify({ loggerInstance: logger });
    await app.register(authPlugin, {
      tokenValidator: mockTokenValidator,
      permissionChecker: mockPermissionChecker,
      relationshipWriter: mockRelationshipWriter,
      teamResolver: { findPersonalTeamId: vi.fn().mockResolvedValue(null) },
    } as never);

    let observedAlsFields: Record<string, unknown> | null = null;

    app.get('/protected', { preHandler: [requireAuth] }, async (request) => {
      observedAlsFields = getRequestContextFields();
      request.log.info({ marker: 'handler' }, 'inside');
      return { ok: true };
    });

    enterRequestContext({ requestId: 'test-req' });

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(response.statusCode).toBe(200);
    expect(observedAlsFields).toMatchObject({
      identityId: VALID_AUTH_CONTEXT.identityId,
      subjectType: 'agent',
      clientId: VALID_AUTH_CONTEXT.clientId,
    });

    // The most direct proof: the actual log line emitted from the
    // handler via request.log carries the identity child bindings.
    const handlerLog = records.find((r) => r.marker === 'handler');
    expect(handlerLog, 'expected log record from handler').toBeDefined();
    expect(handlerLog!.identityId).toBe(VALID_AUTH_CONTEXT.identityId);
    expect(handlerLog!.subjectType).toBe('agent');
    expect(handlerLog!.clientId).toBe(VALID_AUTH_CONTEXT.clientId);
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
    expect(mockSessionResolver.resolveSession).toHaveBeenCalledWith({
      sessionToken: 'valid-session-token',
      cookie: null,
    });
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

describe('requireAuth with cookie-based session', () => {
  let app: FastifyInstance;
  let mockTokenValidator: ReturnType<typeof createMockTokenValidator>;
  let mockPermissionChecker: ReturnType<typeof createMockPermissionChecker>;
  let mockRelationshipWriter: ReturnType<typeof createMockRelationshipWriter>;
  let mockSessionResolver: ReturnType<typeof createMockSessionResolver>;

  const KRATOS_COOKIE =
    'csrf_token=xyz; ory_kratos_session=MTczMjE5ODk2MHxEdjBGQUFFR01; theme=dark';
  const ORY_NETWORK_COOKIE =
    'ory_session_practicalnapier7zp=MTczMjE5ODk2MHw; something=else';
  const UNRELATED_COOKIE = 'theme=dark; csrf_token=xyz; analytics_id=abc123';

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

  it('authenticates when Cookie header contains ory_kratos_session', async () => {
    mockSessionResolver.resolveSession.mockResolvedValue(VALID_SESSION_CONTEXT);

    app.get('/protected', { preHandler: [requireAuth] }, async (request) => {
      return { authContext: request.authContext };
    });

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { cookie: KRATOS_COOKIE },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().authContext).toEqual(VALID_SESSION_CONTEXT);
    expect(mockSessionResolver.resolveSession).toHaveBeenCalledWith({
      sessionToken: null,
      cookie: KRATOS_COOKIE,
    });
  });

  it('authenticates when Cookie header contains ory_session_ (Ory Network)', async () => {
    mockSessionResolver.resolveSession.mockResolvedValue(VALID_SESSION_CONTEXT);

    app.get('/protected', { preHandler: [requireAuth] }, async (request) => {
      return { authContext: request.authContext };
    });

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { cookie: ORY_NETWORK_COOKIE },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().authContext).toEqual(VALID_SESSION_CONTEXT);
  });

  it('does NOT call Kratos when only unrelated cookies are present', async () => {
    // Regression guard: browsers send cookies on every request. We must not
    // round-trip to Kratos for analytics/theme/CSRF cookies that have nothing
    // to do with a Kratos session. Request should fall through to Bearer
    // token, which is also absent → 401.
    app.get('/protected', { preHandler: [requireAuth] }, async () => {
      return { ok: true };
    });

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { cookie: UNRELATED_COOKIE },
    });

    expect(response.statusCode).toBe(401);
    expect(mockSessionResolver.resolveSession).not.toHaveBeenCalled();
  });

  it('does NOT call Kratos when a non-session cookie value contains `ory_session_`', async () => {
    // Regression guard: `String.includes('ory_session_')` would match any
    // cookie VALUE containing that substring (e.g. an analytics_id). The
    // regex gate must only match cookie NAMES.
    const tricky =
      'analytics_id=ory_session_abcdef; theme=dark; csrf_token=xyz';
    app.get('/protected', { preHandler: [requireAuth] }, async () => {
      return { ok: true };
    });

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { cookie: tricky },
    });

    expect(response.statusCode).toBe(401);
    expect(mockSessionResolver.resolveSession).not.toHaveBeenCalled();
  });

  it('session token header wins over browser cookie when both are present', async () => {
    mockSessionResolver.resolveSession.mockResolvedValue(VALID_SESSION_CONTEXT);

    app.get('/protected', { preHandler: [requireAuth] }, async (request) => {
      return { authContext: request.authContext };
    });

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: {
        'x-moltnet-session-token': 'ory_st_native_token',
        cookie: KRATOS_COOKIE,
      },
    });

    expect(response.statusCode).toBe(200);
    // Plugin passes both to the resolver; resolver itself prefers the token.
    expect(mockSessionResolver.resolveSession).toHaveBeenCalledWith({
      sessionToken: 'ory_st_native_token',
      cookie: KRATOS_COOKIE,
    });
  });

  it('treats empty Session-Token header as absent and uses cookie instead', async () => {
    mockSessionResolver.resolveSession.mockResolvedValue(VALID_SESSION_CONTEXT);

    app.get('/protected', { preHandler: [requireAuth] }, async (request) => {
      return { authContext: request.authContext };
    });

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: {
        'x-moltnet-session-token': '',
        cookie: KRATOS_COOKIE,
      },
    });

    expect(response.statusCode).toBe(200);
    // extractSessionToken() already returns null for empty/whitespace, so the
    // resolver receives sessionToken: null — not an empty string.
    expect(mockSessionResolver.resolveSession).toHaveBeenCalledWith({
      sessionToken: null,
      cookie: KRATOS_COOKIE,
    });
  });

  it('falls through to Bearer when cookie session is invalid', async () => {
    mockSessionResolver.resolveSession.mockResolvedValue(null);
    mockTokenValidator.resolveAuthContext.mockResolvedValue(VALID_AUTH_CONTEXT);

    app.get('/protected', { preHandler: [requireAuth] }, async (request) => {
      return { authContext: request.authContext };
    });

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: {
        cookie: KRATOS_COOKIE,
        authorization: `Bearer ${VALID_TOKEN}`,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().authContext).toEqual(VALID_AUTH_CONTEXT);
  });

  it('returns 401 when cookie session is invalid and no Bearer present', async () => {
    mockSessionResolver.resolveSession.mockResolvedValue(null);

    app.get('/protected', { preHandler: [requireAuth] }, async () => {
      return { ok: true };
    });

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { cookie: KRATOS_COOKIE },
    });

    expect(response.statusCode).toBe(401);
  });
});

describe('optionalAuth with cookie-based session', () => {
  let app: FastifyInstance;
  let mockTokenValidator: ReturnType<typeof createMockTokenValidator>;
  let mockPermissionChecker: ReturnType<typeof createMockPermissionChecker>;
  let mockRelationshipWriter: ReturnType<typeof createMockRelationshipWriter>;
  let mockSessionResolver: ReturnType<typeof createMockSessionResolver>;

  const KRATOS_COOKIE =
    'csrf_token=xyz; ory_kratos_session=MTczMjE5ODk2MHxEdjBGQUFFR01';
  const UNRELATED_COOKIE = 'theme=dark; csrf_token=xyz';

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

  it('authenticates via Kratos cookie when present', async () => {
    mockSessionResolver.resolveSession.mockResolvedValue(VALID_SESSION_CONTEXT);

    app.get('/optional', { preHandler: [optionalAuth] }, async (request) => {
      return { authContext: request.authContext };
    });

    const response = await app.inject({
      method: 'GET',
      url: '/optional',
      headers: { cookie: KRATOS_COOKIE },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().authContext).toEqual(VALID_SESSION_CONTEXT);
  });

  it('does NOT round-trip to Kratos for unrelated cookies', async () => {
    app.get('/optional', { preHandler: [optionalAuth] }, async (request) => {
      return { authContext: request.authContext };
    });

    const response = await app.inject({
      method: 'GET',
      url: '/optional',
      headers: { cookie: UNRELATED_COOKIE },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().authContext).toBeNull();
    expect(mockSessionResolver.resolveSession).not.toHaveBeenCalled();
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
