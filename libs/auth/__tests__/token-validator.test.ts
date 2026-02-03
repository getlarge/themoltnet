import crypto from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createTokenValidator,
  type TokenValidator,
} from '../src/token-validator.js';

// Mock types matching @ory/client API shapes
interface MockOAuth2Api {
  introspectOAuth2Token: ReturnType<typeof vi.fn>;
  getOAuth2Client: ReturnType<typeof vi.fn>;
}

function createMockOAuth2Api(): MockOAuth2Api {
  return {
    introspectOAuth2Token: vi.fn(),
    getOAuth2Client: vi.fn(),
  };
}

const OPAQUE_TOKEN = 'ory_at_valid_token_123';
const VALID_CLIENT_ID = 'hydra-client-uuid';
const VALID_IDENTITY_ID = '550e8400-e29b-41d4-a716-446655440000';

const MOLTNET_EXT_CLAIMS = {
  'moltnet:identity_id': VALID_IDENTITY_ID,
  'moltnet:public_key': 'ed25519:AAAA+/bbbb==',
  'moltnet:fingerprint': 'A1B2-C3D4-E5F6-07A8',
};

const EXPECTED_AUTH_CONTEXT = {
  identityId: VALID_IDENTITY_ID,
  publicKey: 'ed25519:AAAA+/bbbb==',
  fingerprint: 'A1B2-C3D4-E5F6-07A8',
  clientId: VALID_CLIENT_ID,
  scopes: ['diary:read', 'diary:write'],
};

// Generate a test RSA keypair for JWT signing
const { privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
});

function createTestJwt(
  claims: Record<string, unknown> = {},
  options: { kid?: string; alg?: string; expiresInSec?: number } = {},
): string {
  const header = {
    alg: options.alg ?? 'RS256',
    typ: 'JWT',
    ...(options.kid ? { kid: options.kid } : {}),
  };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: VALID_CLIENT_ID,
    client_id: VALID_CLIENT_ID,
    scope: 'diary:read diary:write',
    iss: 'https://auth.example.com',
    iat: now,
    exp: now + (options.expiresInSec ?? 3600),
    ...claims,
  };

  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.sign(
    'sha256',
    Buffer.from(`${headerB64}.${payloadB64}`),
    privateKey,
  );
  return `${headerB64}.${payloadB64}.${signature.toString('base64url')}`;
}

describe('TokenValidator', () => {
  describe('without JWKS (introspection only)', () => {
    let mockOAuth2Api: MockOAuth2Api;
    let validator: TokenValidator;

    beforeEach(() => {
      mockOAuth2Api = createMockOAuth2Api();
      validator = createTokenValidator(mockOAuth2Api as any);
    });

    describe('introspect', () => {
      it('returns token info for a valid active opaque token', async () => {
        mockOAuth2Api.introspectOAuth2Token.mockResolvedValue({
          data: {
            active: true,
            client_id: VALID_CLIENT_ID,
            scope: 'diary:read diary:write agent:profile',
            sub: VALID_CLIENT_ID,
            exp: Math.floor(Date.now() / 1000) + 3600,
            ext: MOLTNET_EXT_CLAIMS,
          },
        });

        const result = await validator.introspect(OPAQUE_TOKEN);

        expect(result).toEqual({
          active: true,
          clientId: VALID_CLIENT_ID,
          scopes: ['diary:read', 'diary:write', 'agent:profile'],
          expiresAt: expect.any(Number),
          ext: MOLTNET_EXT_CLAIMS,
        });
        expect(mockOAuth2Api.introspectOAuth2Token).toHaveBeenCalledWith({
          token: OPAQUE_TOKEN,
        });
      });

      it('returns inactive result for revoked/expired token', async () => {
        mockOAuth2Api.introspectOAuth2Token.mockResolvedValue({
          data: { active: false },
        });

        const result = await validator.introspect(OPAQUE_TOKEN);

        expect(result).toEqual({ active: false });
      });

      it('returns inactive result when introspection request fails', async () => {
        mockOAuth2Api.introspectOAuth2Token.mockRejectedValue(
          new Error('Network error'),
        );

        const result = await validator.introspect(OPAQUE_TOKEN);

        expect(result).toEqual({ active: false });
      });

      it('handles token with empty scope string', async () => {
        mockOAuth2Api.introspectOAuth2Token.mockResolvedValue({
          data: {
            active: true,
            client_id: VALID_CLIENT_ID,
            scope: '',
            sub: VALID_CLIENT_ID,
          },
        });

        const result = await validator.introspect(OPAQUE_TOKEN);

        expect(result.active).toBe(true);
        if (result.active) {
          expect(result.scopes).toEqual([]);
        }
      });

      it('handles token with no scope field', async () => {
        mockOAuth2Api.introspectOAuth2Token.mockResolvedValue({
          data: {
            active: true,
            client_id: VALID_CLIENT_ID,
            sub: VALID_CLIENT_ID,
          },
        });

        const result = await validator.introspect(OPAQUE_TOKEN);

        expect(result.active).toBe(true);
        if (result.active) {
          expect(result.scopes).toEqual([]);
        }
      });

      it('handles token with no ext field', async () => {
        mockOAuth2Api.introspectOAuth2Token.mockResolvedValue({
          data: {
            active: true,
            client_id: VALID_CLIENT_ID,
            scope: 'diary:read',
            sub: VALID_CLIENT_ID,
          },
        });

        const result = await validator.introspect(OPAQUE_TOKEN);

        expect(result.active).toBe(true);
        if (result.active) {
          expect(result.ext).toEqual({});
        }
      });
    });

    describe('resolveAuthContext', () => {
      it('resolves auth context from enriched opaque token', async () => {
        mockOAuth2Api.introspectOAuth2Token.mockResolvedValue({
          data: {
            active: true,
            client_id: VALID_CLIENT_ID,
            scope: 'diary:read diary:write',
            sub: VALID_CLIENT_ID,
            ext: MOLTNET_EXT_CLAIMS,
          },
        });

        const result = await validator.resolveAuthContext(OPAQUE_TOKEN);

        expect(result).toEqual(EXPECTED_AUTH_CONTEXT);
      });

      it('uses introspection for opaque tokens even when no JWKS configured', async () => {
        mockOAuth2Api.introspectOAuth2Token.mockResolvedValue({
          data: {
            active: true,
            client_id: VALID_CLIENT_ID,
            scope: 'diary:read diary:write',
            sub: VALID_CLIENT_ID,
            ext: MOLTNET_EXT_CLAIMS,
          },
        });

        await validator.resolveAuthContext(OPAQUE_TOKEN);

        expect(mockOAuth2Api.introspectOAuth2Token).toHaveBeenCalledWith({
          token: OPAQUE_TOKEN,
        });
      });

      it('uses introspection for JWT-shaped tokens when no JWKS configured', async () => {
        const jwtToken = createTestJwt();
        mockOAuth2Api.introspectOAuth2Token.mockResolvedValue({
          data: {
            active: true,
            client_id: VALID_CLIENT_ID,
            scope: 'diary:read diary:write',
            sub: VALID_CLIENT_ID,
            ext: MOLTNET_EXT_CLAIMS,
          },
        });

        const result = await validator.resolveAuthContext(jwtToken);

        expect(result).toEqual(EXPECTED_AUTH_CONTEXT);
        expect(mockOAuth2Api.introspectOAuth2Token).toHaveBeenCalled();
      });

      it('falls back to client metadata when token has no ext claims', async () => {
        mockOAuth2Api.introspectOAuth2Token.mockResolvedValue({
          data: {
            active: true,
            client_id: VALID_CLIENT_ID,
            scope: 'diary:read diary:write',
            sub: VALID_CLIENT_ID,
          },
        });

        mockOAuth2Api.getOAuth2Client.mockResolvedValue({
          data: {
            client_id: VALID_CLIENT_ID,
            metadata: {
              identity_id: VALID_IDENTITY_ID,
              public_key: 'ed25519:AAAA+/bbbb==',
              fingerprint: 'A1B2-C3D4-E5F6-07A8',
            },
          },
        });

        const result = await validator.resolveAuthContext(OPAQUE_TOKEN);

        expect(result).toEqual(EXPECTED_AUTH_CONTEXT);
        expect(mockOAuth2Api.getOAuth2Client).toHaveBeenCalledWith({
          id: VALID_CLIENT_ID,
        });
      });

      it('returns null for inactive token', async () => {
        mockOAuth2Api.introspectOAuth2Token.mockResolvedValue({
          data: { active: false },
        });

        const result = await validator.resolveAuthContext(OPAQUE_TOKEN);

        expect(result).toBeNull();
      });

      it('returns null when client metadata is missing identity info', async () => {
        mockOAuth2Api.introspectOAuth2Token.mockResolvedValue({
          data: {
            active: true,
            client_id: VALID_CLIENT_ID,
            scope: 'diary:read',
            sub: VALID_CLIENT_ID,
          },
        });

        mockOAuth2Api.getOAuth2Client.mockResolvedValue({
          data: {
            client_id: VALID_CLIENT_ID,
            metadata: {},
          },
        });

        const result = await validator.resolveAuthContext(OPAQUE_TOKEN);

        expect(result).toBeNull();
      });

      it('returns null when getOAuth2Client fails', async () => {
        mockOAuth2Api.introspectOAuth2Token.mockResolvedValue({
          data: {
            active: true,
            client_id: VALID_CLIENT_ID,
            scope: 'diary:read',
            sub: VALID_CLIENT_ID,
          },
        });

        mockOAuth2Api.getOAuth2Client.mockRejectedValue(
          new Error('Client not found'),
        );

        const result = await validator.resolveAuthContext(OPAQUE_TOKEN);

        expect(result).toBeNull();
      });

      it('returns null when client_id is missing from introspection', async () => {
        mockOAuth2Api.introspectOAuth2Token.mockResolvedValue({
          data: {
            active: true,
            scope: 'diary:read',
          },
        });

        const result = await validator.resolveAuthContext(OPAQUE_TOKEN);

        expect(result).toBeNull();
      });
    });
  });

  describe('token type detection', () => {
    let mockOAuth2Api: MockOAuth2Api;
    let validator: TokenValidator;

    beforeEach(() => {
      mockOAuth2Api = createMockOAuth2Api();
      validator = createTokenValidator(mockOAuth2Api as any);
    });

    it('routes ory_at_ prefixed tokens to introspection', async () => {
      mockOAuth2Api.introspectOAuth2Token.mockResolvedValue({
        data: {
          active: true,
          client_id: VALID_CLIENT_ID,
          scope: 'diary:read',
          sub: VALID_CLIENT_ID,
          ext: MOLTNET_EXT_CLAIMS,
        },
      });

      await validator.resolveAuthContext('ory_at_some_opaque_value');

      expect(mockOAuth2Api.introspectOAuth2Token).toHaveBeenCalledWith({
        token: 'ory_at_some_opaque_value',
      });
    });

    it('routes ory_ht_ prefixed tokens to introspection', async () => {
      mockOAuth2Api.introspectOAuth2Token.mockResolvedValue({
        data: {
          active: true,
          client_id: VALID_CLIENT_ID,
          scope: 'diary:read',
          sub: VALID_CLIENT_ID,
          ext: MOLTNET_EXT_CLAIMS,
        },
      });

      await validator.resolveAuthContext('ory_ht_some_opaque_value');

      expect(mockOAuth2Api.introspectOAuth2Token).toHaveBeenCalledWith({
        token: 'ory_ht_some_opaque_value',
      });
    });

    it('routes unknown-format tokens to introspection', async () => {
      mockOAuth2Api.introspectOAuth2Token.mockResolvedValue({
        data: { active: false },
      });

      const result = await validator.resolveAuthContext('random_unknown_token');

      expect(result).toBeNull();
      expect(mockOAuth2Api.introspectOAuth2Token).toHaveBeenCalled();
    });
  });

  describe('with JWKS (JWT + introspection)', () => {
    let mockOAuth2Api: MockOAuth2Api;

    beforeEach(() => {
      mockOAuth2Api = createMockOAuth2Api();
    });

    it('still uses introspection for opaque tokens when JWKS is configured', async () => {
      const validator = createTokenValidator(mockOAuth2Api as any, {
        jwksUri: 'https://auth.example.com/.well-known/jwks.json',
      });

      mockOAuth2Api.introspectOAuth2Token.mockResolvedValue({
        data: {
          active: true,
          client_id: VALID_CLIENT_ID,
          scope: 'diary:read diary:write',
          sub: VALID_CLIENT_ID,
          ext: MOLTNET_EXT_CLAIMS,
        },
      });

      const result = await validator.resolveAuthContext(OPAQUE_TOKEN);

      expect(result).toEqual(EXPECTED_AUTH_CONTEXT);
      expect(mockOAuth2Api.introspectOAuth2Token).toHaveBeenCalledWith({
        token: OPAQUE_TOKEN,
      });
    });

    it('falls back to introspection when JWT validation fails', async () => {
      const validator = createTokenValidator(mockOAuth2Api as any, {
        jwksUri: 'https://auth.example.com/.well-known/jwks.json',
      });

      // JWT with a valid shape but signed by unknown key — JWKS fetch will fail
      const jwtToken = createTestJwt();

      mockOAuth2Api.introspectOAuth2Token.mockResolvedValue({
        data: {
          active: true,
          client_id: VALID_CLIENT_ID,
          scope: 'diary:read diary:write',
          sub: VALID_CLIENT_ID,
          ext: MOLTNET_EXT_CLAIMS,
        },
      });

      const result = await validator.resolveAuthContext(jwtToken);

      // Should have fallen back to introspection
      expect(result).toEqual(EXPECTED_AUTH_CONTEXT);
      expect(mockOAuth2Api.introspectOAuth2Token).toHaveBeenCalled();
    });

    it('returns null when both JWT validation and introspection fail', async () => {
      const validator = createTokenValidator(mockOAuth2Api as any, {
        jwksUri: 'https://auth.example.com/.well-known/jwks.json',
      });

      const jwtToken = createTestJwt();

      mockOAuth2Api.introspectOAuth2Token.mockResolvedValue({
        data: { active: false },
      });

      const result = await validator.resolveAuthContext(jwtToken);

      expect(result).toBeNull();
    });

    it('accepts custom algorithms configuration', () => {
      // Should not throw
      const validator = createTokenValidator(mockOAuth2Api as any, {
        jwksUri: 'https://auth.example.com/.well-known/jwks.json',
        algorithms: ['RS256', 'ES256'],
        allowedIssuers: ['https://auth.example.com'],
        allowedAudiences: ['https://api.themolt.net'],
        cacheMax: 100,
        cacheTtl: 300_000,
      });

      expect(validator).toBeDefined();
      expect(validator.introspect).toBeInstanceOf(Function);
      expect(validator.resolveAuthContext).toBeInstanceOf(Function);
    });
  });
});
