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

const VALID_TOKEN = 'ory_at_valid_token_123';
const VALID_CLIENT_ID = 'hydra-client-uuid';
const VALID_IDENTITY_ID = '550e8400-e29b-41d4-a716-446655440000';

describe('TokenValidator', () => {
  let mockOAuth2Api: MockOAuth2Api;
  let validator: TokenValidator;

  beforeEach(() => {
    mockOAuth2Api = createMockOAuth2Api();
     
    validator = createTokenValidator(mockOAuth2Api as any);
  });

  describe('introspect', () => {
    it('returns token info for a valid active token', async () => {
      mockOAuth2Api.introspectOAuth2Token.mockResolvedValue({
        data: {
          active: true,
          client_id: VALID_CLIENT_ID,
          scope: 'diary:read diary:write agent:profile',
          sub: VALID_CLIENT_ID,
          exp: Math.floor(Date.now() / 1000) + 3600,
          ext: {
            'moltnet:identity_id': VALID_IDENTITY_ID,
            'moltnet:moltbook_name': 'Claude',
            'moltnet:public_key': 'ed25519:AAAA+/bbbb==',
            'moltnet:key_fingerprint': 'A1B2-C3D4-E5F6-07A8',
          },
        },
      });

      const result = await validator.introspect(VALID_TOKEN);

      expect(result).toEqual({
        active: true,
        clientId: VALID_CLIENT_ID,
        scopes: ['diary:read', 'diary:write', 'agent:profile'],
        expiresAt: expect.any(Number),
        ext: {
          'moltnet:identity_id': VALID_IDENTITY_ID,
          'moltnet:moltbook_name': 'Claude',
          'moltnet:public_key': 'ed25519:AAAA+/bbbb==',
          'moltnet:key_fingerprint': 'A1B2-C3D4-E5F6-07A8',
        },
      });
      expect(mockOAuth2Api.introspectOAuth2Token).toHaveBeenCalledWith({
        token: VALID_TOKEN,
      });
    });

    it('returns inactive result for revoked/expired token', async () => {
      mockOAuth2Api.introspectOAuth2Token.mockResolvedValue({
        data: { active: false },
      });

      const result = await validator.introspect(VALID_TOKEN);

      expect(result).toEqual({ active: false });
    });

    it('returns inactive result when introspection request fails', async () => {
      mockOAuth2Api.introspectOAuth2Token.mockRejectedValue(
        new Error('Network error'),
      );

      const result = await validator.introspect(VALID_TOKEN);

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

      const result = await validator.introspect(VALID_TOKEN);

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

      const result = await validator.introspect(VALID_TOKEN);

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

      const result = await validator.introspect(VALID_TOKEN);

      expect(result.active).toBe(true);
      if (result.active) {
        expect(result.ext).toEqual({});
      }
    });
  });

  describe('resolveAuthContext', () => {
    it('resolves full auth context from enriched token', async () => {
      mockOAuth2Api.introspectOAuth2Token.mockResolvedValue({
        data: {
          active: true,
          client_id: VALID_CLIENT_ID,
          scope: 'diary:read diary:write',
          sub: VALID_CLIENT_ID,
          ext: {
            'moltnet:identity_id': VALID_IDENTITY_ID,
            'moltnet:moltbook_name': 'Claude',
            'moltnet:public_key': 'ed25519:AAAA+/bbbb==',
            'moltnet:key_fingerprint': 'A1B2-C3D4-E5F6-07A8',
          },
        },
      });

      const result = await validator.resolveAuthContext(VALID_TOKEN);

      expect(result).toEqual({
        identityId: VALID_IDENTITY_ID,
        moltbookName: 'Claude',
        publicKey: 'ed25519:AAAA+/bbbb==',
        fingerprint: 'A1B2-C3D4-E5F6-07A8',
        clientId: VALID_CLIENT_ID,
        scopes: ['diary:read', 'diary:write'],
      });
    });

    it('falls back to client metadata when token has no ext claims', async () => {
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
          metadata: {
            identity_id: VALID_IDENTITY_ID,
            moltbook_name: 'Claude',
            public_key: 'ed25519:AAAA+/bbbb==',
            key_fingerprint: 'A1B2-C3D4-E5F6-07A8',
          },
        },
      });

      const result = await validator.resolveAuthContext(VALID_TOKEN);

      expect(result).toEqual({
        identityId: VALID_IDENTITY_ID,
        moltbookName: 'Claude',
        publicKey: 'ed25519:AAAA+/bbbb==',
        fingerprint: 'A1B2-C3D4-E5F6-07A8',
        clientId: VALID_CLIENT_ID,
        scopes: ['diary:read'],
      });
      expect(mockOAuth2Api.getOAuth2Client).toHaveBeenCalledWith({
        id: VALID_CLIENT_ID,
      });
    });

    it('returns null for inactive token', async () => {
      mockOAuth2Api.introspectOAuth2Token.mockResolvedValue({
        data: { active: false },
      });

      const result = await validator.resolveAuthContext(VALID_TOKEN);

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

      const result = await validator.resolveAuthContext(VALID_TOKEN);

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

      const result = await validator.resolveAuthContext(VALID_TOKEN);

      expect(result).toBeNull();
    });

    it('returns null when client_id is missing from introspection', async () => {
      mockOAuth2Api.introspectOAuth2Token.mockResolvedValue({
        data: {
          active: true,
          scope: 'diary:read',
        },
      });

      const result = await validator.resolveAuthContext(VALID_TOKEN);

      expect(result).toBeNull();
    });
  });
});
