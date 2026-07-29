import http from 'node:http';

import { exportJWK, generateKeyPair, type JWK, SignJWT } from 'jose';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import {
  createTokenValidator,
  type TokenValidatorConfig,
} from '../src/token-validator.js';

const API_AUDIENCE = 'https://api.themolt.net';
const CLIENT_ID = 'hydra-client-uuid';
const IDENTITY_ID = '550e8400-e29b-41d4-a716-446655440000';
const OPAQUE_TOKEN = 'ory_at_valid_token_123';

const MOLTNET_CLAIMS = {
  'moltnet:fingerprint': 'A1B2-C3D4-E5F6-07A8',
  'moltnet:identity_id': IDENTITY_ID,
  'moltnet:public_key': 'ed25519:AAAA+/bbbb==',
};

const EXPECTED_AUTH_CONTEXT = {
  clientId: CLIENT_ID,
  currentTeamId: null,
  fingerprint: 'A1B2-C3D4-E5F6-07A8',
  identityId: IDENTITY_ID,
  publicKey: 'ed25519:AAAA+/bbbb==',
  scopes: ['diary:read', 'diary:write'],
  subjectType: 'agent',
};

interface SigningFixture {
  algorithm: 'ES256' | 'RS256';
  kid: string;
  privateKey: CryptoKey;
  publicJwk: JWK;
}

interface TestJwksServer {
  close(): Promise<void>;
  issuer: string;
  jwksUri: string;
  requestCount(): number;
  setKeys(keys: JWK[]): void;
  setMode(mode: 'hang' | 'jwks' | 'unavailable'): void;
}

interface MockOAuth2Api {
  getOAuth2Client: ReturnType<typeof vi.fn>;
  introspectOAuth2Token: ReturnType<typeof vi.fn>;
}

let es256: SigningFixture;
let rs256A: SigningFixture;
let rs256B: SigningFixture;

async function createSigningFixture(
  algorithm: SigningFixture['algorithm'],
  kid: string,
): Promise<SigningFixture> {
  const { privateKey, publicKey } = await generateKeyPair(algorithm);
  return {
    algorithm,
    kid,
    privateKey,
    publicJwk: {
      ...(await exportJWK(publicKey)),
      alg: algorithm,
      kid,
      use: 'sig',
    },
  };
}

function createMockOAuth2Api(): MockOAuth2Api {
  return {
    getOAuth2Client: vi.fn(),
    introspectOAuth2Token: vi.fn(),
  };
}

function activeIntrospection() {
  return {
    active: true,
    client_id: CLIENT_ID,
    ext: MOLTNET_CLAIMS,
    scope: 'diary:read diary:write',
    sub: CLIENT_ID,
  };
}

async function createTestJwt(
  fixture: SigningFixture,
  issuer: string,
  options: {
    audience?: string;
    expiresAt?: number;
    extraClaims?: Record<string, unknown>;
    kid?: string | null;
  } = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1_000);
  const jwt = new SignJWT({
    client_id: CLIENT_ID,
    ...MOLTNET_CLAIMS,
    scope: 'diary:read diary:write',
    ...options.extraClaims,
  })
    .setProtectedHeader({
      alg: fixture.algorithm,
      ...(options.kid === null ? {} : { kid: options.kid ?? fixture.kid }),
      typ: 'JWT',
    })
    .setIssuer(issuer)
    .setSubject(CLIENT_ID)
    .setIssuedAt(now)
    .setExpirationTime(options.expiresAt ?? now + 3_600);
  if (options.audience) {
    jwt.setAudience(options.audience);
  }
  return jwt.sign(fixture.privateKey);
}

async function startJwksServer(initialKeys: JWK[]): Promise<TestJwksServer> {
  let keys = initialKeys;
  let mode: 'hang' | 'jwks' | 'unavailable' = 'jwks';
  let requests = 0;
  const server = http.createServer((_request, response) => {
    requests += 1;
    if (mode === 'hang') return;
    if (mode === 'unavailable') {
      response.writeHead(503, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'unavailable' }));
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ keys }));
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Test JWKS server did not bind to a TCP port');
  }
  const issuer = `http://127.0.0.1:${address.port}`;

  return {
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
    issuer,
    jwksUri: `${issuer}/.well-known/jwks.json`,
    requestCount: () => requests,
    setKeys(nextKeys) {
      keys = nextKeys;
    },
    setMode(nextMode) {
      mode = nextMode;
    },
  };
}

function createValidator(
  oauth2Api: MockOAuth2Api,
  server: TestJwksServer,
  config: Omit<TokenValidatorConfig, 'jwksUri'> = {},
) {
  return createTokenValidator(oauth2Api as never, {
    ...config,
    jwksUri: server.jwksUri,
  });
}

beforeAll(async () => {
  [es256, rs256A, rs256B] = await Promise.all([
    createSigningFixture('ES256', 'es256-key'),
    createSigningFixture('RS256', 'rs256-key-a'),
    createSigningFixture('RS256', 'rs256-key-b'),
  ]);
});

describe('TokenValidator jose JWT verification', () => {
  it('verifies RS256 tokens and reuses the warm JWKS cache', async () => {
    const server = await startJwksServer([rs256A.publicJwk]);
    try {
      const oauth2Api = createMockOAuth2Api();
      oauth2Api.introspectOAuth2Token.mockResolvedValue({ active: false });
      const validator = createValidator(oauth2Api, server);
      const token = await createTestJwt(rs256A, server.issuer);

      const first = await validator.resolveAuthContext(token);
      const second = await validator.resolveAuthContext(token);

      expect(first).toEqual(EXPECTED_AUTH_CONTEXT);
      expect(second).toEqual(EXPECTED_AUTH_CONTEXT);
      expect(server.requestCount()).toBe(1);
      expect(oauth2Api.introspectOAuth2Token).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it('enforces an exact configured audience', async () => {
    const server = await startJwksServer([rs256A.publicJwk]);
    try {
      const oauth2Api = createMockOAuth2Api();
      oauth2Api.introspectOAuth2Token.mockResolvedValue({ active: false });
      const validator = createValidator(oauth2Api, server, {
        allowedAudiences: [API_AUDIENCE],
      });
      const token = await createTestJwt(rs256A, server.issuer, {
        audience: API_AUDIENCE,
      });

      const result = await validator.resolveAuthContext(token);

      expect(result).toEqual(EXPECTED_AUTH_CONTEXT);
      expect(oauth2Api.introspectOAuth2Token).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it.each([
    {
      name: 'wrong issuer',
      token: (server: TestJwksServer) =>
        createTestJwt(rs256A, `${server.issuer}/wrong`, {
          audience: API_AUDIENCE,
        }),
    },
    {
      name: 'wrong audience',
      token: (server: TestJwksServer) =>
        createTestJwt(rs256A, server.issuer, {
          audience: 'https://other.example.com',
        }),
    },
    {
      name: 'missing audience',
      token: (server: TestJwksServer) => createTestJwt(rs256A, server.issuer),
    },
    {
      name: 'invalid signature',
      token: (server: TestJwksServer) =>
        createTestJwt(rs256B, server.issuer, {
          audience: API_AUDIENCE,
          kid: rs256A.kid,
        }),
    },
    {
      name: 'expired token',
      token: (server: TestJwksServer) =>
        createTestJwt(rs256A, server.issuer, {
          audience: API_AUDIENCE,
          expiresAt: Math.floor(Date.now() / 1_000) - 10,
        }),
    },
    {
      name: 'unknown key ID',
      token: (server: TestJwksServer) =>
        createTestJwt(rs256B, server.issuer, {
          audience: API_AUDIENCE,
        }),
    },
  ])('falls back to introspection for $name', async ({ token }) => {
    const server = await startJwksServer([rs256A.publicJwk]);
    try {
      const oauth2Api = createMockOAuth2Api();
      oauth2Api.introspectOAuth2Token.mockResolvedValue(activeIntrospection());
      const validator = createValidator(oauth2Api, server, {
        allowedAudiences: [API_AUDIENCE],
        jwksCooldownMs: 0,
      });

      const result = await validator.resolveAuthContext(await token(server));

      expect(result).toEqual(EXPECTED_AUTH_CONTEXT);
      expect(oauth2Api.introspectOAuth2Token).toHaveBeenCalledOnce();
    } finally {
      await server.close();
    }
  });

  it('hard-pins Ory JWT verification to RS256', async () => {
    const server = await startJwksServer([es256.publicJwk]);
    try {
      const oauth2Api = createMockOAuth2Api();
      oauth2Api.introspectOAuth2Token.mockResolvedValue(activeIntrospection());
      const logger = { debug: vi.fn(), warn: vi.fn() };
      const validator = createValidator(oauth2Api, server, { logger });
      const token = await createTestJwt(es256, server.issuer);

      const result = await validator.resolveAuthContext(token);

      expect(result).toEqual(EXPECTED_AUTH_CONTEXT);
      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          credentialType: 'ory-jwt',
          reason: 'algorithm_rejected',
        }),
        'Ory JWT rejected',
      );
    } finally {
      await server.close();
    }
  });

  it('refreshes the JWKS when a rotated key ID is encountered', async () => {
    const server = await startJwksServer([rs256A.publicJwk]);
    try {
      const oauth2Api = createMockOAuth2Api();
      oauth2Api.introspectOAuth2Token.mockResolvedValue({ active: false });
      const validator = createValidator(oauth2Api, server, {
        jwksCooldownMs: 0,
      });
      const firstToken = await createTestJwt(rs256A, server.issuer);
      const rotatedToken = await createTestJwt(rs256B, server.issuer);

      expect(await validator.resolveAuthContext(firstToken)).toEqual(
        EXPECTED_AUTH_CONTEXT,
      );
      server.setKeys([rs256B.publicJwk]);
      expect(await validator.resolveAuthContext(rotatedToken)).toEqual(
        EXPECTED_AUTH_CONTEXT,
      );
      expect(server.requestCount()).toBe(2);
    } finally {
      await server.close();
    }
  });

  it('falls back safely when the JWKS request times out', async () => {
    const server = await startJwksServer([rs256A.publicJwk]);
    server.setMode('hang');
    try {
      const oauth2Api = createMockOAuth2Api();
      oauth2Api.introspectOAuth2Token.mockResolvedValue(activeIntrospection());
      const logger = { debug: vi.fn(), warn: vi.fn() };
      const validator = createValidator(oauth2Api, server, {
        jwksTimeoutMs: 10,
        logger,
      });
      const token = await createTestJwt(rs256A, server.issuer, {
        extraClaims: { private_marker: 'never-log-this-token' },
      });

      const result = await validator.resolveAuthContext(token);

      expect(result).toEqual(EXPECTED_AUTH_CONTEXT);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          credentialType: 'ory-jwt',
          reason: 'jwks_unavailable',
        }),
        'Ory JWT verification unavailable',
      );
      const serializedLogs = JSON.stringify(logger.warn.mock.calls);
      expect(serializedLogs).not.toContain(token);
      expect(serializedLogs).not.toContain('never-log-this-token');
    } finally {
      await server.close();
    }
  });

  it('fails closed when JWKS and introspection are unavailable', async () => {
    const server = await startJwksServer([rs256A.publicJwk]);
    server.setMode('unavailable');
    try {
      const oauth2Api = createMockOAuth2Api();
      oauth2Api.introspectOAuth2Token.mockResolvedValue({ active: false });
      const logger = { debug: vi.fn(), warn: vi.fn() };
      const validator = createValidator(oauth2Api, server, { logger });
      const token = await createTestJwt(rs256A, server.issuer);

      const result = await validator.resolveAuthContext(token);

      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          credentialType: 'ory-jwt',
          reason: 'jwks_unavailable',
        }),
        'Ory JWT verification unavailable',
      );
    } finally {
      await server.close();
    }
  });

  it('routes opaque Ory tokens directly to introspection', async () => {
    const server = await startJwksServer([rs256A.publicJwk]);
    try {
      const oauth2Api = createMockOAuth2Api();
      oauth2Api.introspectOAuth2Token.mockResolvedValue(activeIntrospection());
      const validator = createValidator(oauth2Api, server);

      const result = await validator.resolveAuthContext(OPAQUE_TOKEN);

      expect(result).toEqual(EXPECTED_AUTH_CONTEXT);
      expect(server.requestCount()).toBe(0);
      expect(oauth2Api.introspectOAuth2Token).toHaveBeenCalledWith({
        token: OPAQUE_TOKEN,
      });
    } finally {
      await server.close();
    }
  });
});
