import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  authPlugin,
  optionalAuth,
  requireAuth,
  requireScopes,
} from '../src/plugin.js';
import type { AuthContext } from '../src/types.js';

const VALID_TOKEN = 'ory_at_valid_token_123';
const VALID_AUTH_CONTEXT: AuthContext = {
  identityId: '550e8400-e29b-41d4-a716-446655440000',
  publicKey: 'ed25519:AAAA+/bbbb==',
  fingerprint: 'A1B2-C3D4-E5F6-07A8',
  clientId: 'hydra-client-uuid',
  scopes: ['diary:read', 'diary:write', 'agent:profile'],
};

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
    canShareEntry: vi.fn(),
    grantOwnership: vi.fn(),
    grantViewer: vi.fn(),
    revokeViewer: vi.fn(),
    registerAgent: vi.fn(),
    removeEntryRelations: vi.fn(),
  };
}

describe('authPlugin', () => {
  let app: FastifyInstance;
  let mockTokenValidator: ReturnType<typeof createMockTokenValidator>;
  let mockPermissionChecker: ReturnType<typeof createMockPermissionChecker>;

  beforeEach(async () => {
    mockTokenValidator = createMockTokenValidator();
    mockPermissionChecker = createMockPermissionChecker();

    app = Fastify();
    await app.register(authPlugin, {
      tokenValidator: mockTokenValidator,
      permissionChecker: mockPermissionChecker,
    });
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
});

describe('requireAuth preHandler', () => {
  let app: FastifyInstance;
  let mockTokenValidator: ReturnType<typeof createMockTokenValidator>;
  let mockPermissionChecker: ReturnType<typeof createMockPermissionChecker>;

  beforeEach(async () => {
    mockTokenValidator = createMockTokenValidator();
    mockPermissionChecker = createMockPermissionChecker();

    app = Fastify();
    await app.register(authPlugin, {
      tokenValidator: mockTokenValidator,
      permissionChecker: mockPermissionChecker,
    });
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

  beforeEach(async () => {
    mockTokenValidator = createMockTokenValidator();
    mockPermissionChecker = createMockPermissionChecker();

    app = Fastify();
    await app.register(authPlugin, {
      tokenValidator: mockTokenValidator,
      permissionChecker: mockPermissionChecker,
    });
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

  beforeEach(async () => {
    mockTokenValidator = createMockTokenValidator();
    mockPermissionChecker = createMockPermissionChecker();

    app = Fastify();
    await app.register(authPlugin, {
      tokenValidator: mockTokenValidator,
      permissionChecker: mockPermissionChecker,
    });
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
