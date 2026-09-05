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

function createMockTalosApi() {
  return {
    adminVerifyApiKey: vi.fn(),
  };
}

function createMockTalosAgentResolver() {
  return vi.fn().mockResolvedValue({
    // Equal to the identity here because migration 0041 seeds agents.id from
    // identity_id, which is what production looks like for existing agents.
    agentId: VALID_IDENTITY_ID,
    identityId: VALID_IDENTITY_ID,
    publicKey: 'ed25519:AAAA+/bbbb==',
    fingerprint: 'A1B2-C3D4-E5F6-07A8',
  });
}

function createMockLogger() {
  return {
    debug: vi.fn(),
    warn: vi.fn(),
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
  agentId: VALID_IDENTITY_ID,
  identityId: VALID_IDENTITY_ID,
  publicKey: 'ed25519:AAAA+/bbbb==',
  fingerprint: 'A1B2-C3D4-E5F6-07A8',
  clientId: VALID_CLIENT_ID,
  scopes: ['diary:read', 'diary:write'],
  subjectType: 'agent',
  currentTeamId: null,
};

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
          active: true,
          client_id: VALID_CLIENT_ID,
          scope: 'diary:read diary:write agent:profile',
          sub: VALID_CLIENT_ID,
          exp: Math.floor(Date.now() / 1000) + 3600,
          ext: MOLTNET_EXT_CLAIMS,
        });

        const result = await validator.introspect(OPAQUE_TOKEN);

        expect(result).toEqual({
          active: true,
          clientId: VALID_CLIENT_ID,
          scopes: ['diary:read', 'diary:write', 'agent:profile'],
          expiresAt: expect.any(Number),
          ext: MOLTNET_EXT_CLAIMS,
        });
        expect(mockOAuth2Api.introspectOAuth2Token).toHaveBeenCalledWith(
          { token: OPAQUE_TOKEN },
          { signal: expect.any(AbortSignal) },
        );
      });

      it('returns inactive result for revoked/expired token', async () => {
        mockOAuth2Api.introspectOAuth2Token.mockResolvedValue({
          active: false,
        });

        const result = await validator.introspect(OPAQUE_TOKEN);

        expect(result).toEqual({ active: false });
      });

      it('surfaces provider unavailability and logs safely when introspection fails', async () => {
        const logger = createMockLogger();
        const onValidationEvent = vi.fn();
        validator = createTokenValidator(mockOAuth2Api as any, {
          logger,
          onValidationEvent,
        });
        mockOAuth2Api.introspectOAuth2Token.mockRejectedValue(
          Object.assign(new Error('never-log-this-upstream-error'), {
            cause: { code: 'ECONNRESET' },
            name: 'ResponseError',
            response: { status: 503 },
          }),
        );

        await expect(validator.introspect(OPAQUE_TOKEN)).rejects.toMatchObject({
          kind: 'unavailable',
          operation: 'oauth2.introspect',
        });
        expect(logger.warn).toHaveBeenCalledWith(
          {
            causeCode: 'ECONNRESET',
            credentialType: 'ory-token',
            errorType: 'ResponseError',
            reason: 'introspection_unavailable',
            status: 503,
          },
          'Ory token introspection unavailable',
        );
        expect(onValidationEvent).toHaveBeenCalledWith({
          credentialType: 'ory-token',
          reason: 'introspection_unavailable',
        });
        const serializedLogs = JSON.stringify(logger.warn.mock.calls);
        expect(serializedLogs).not.toContain(OPAQUE_TOKEN);
        expect(serializedLogs).not.toContain('never-log-this-upstream-error');
      });

      it('preserves provider throttling and Retry-After', async () => {
        mockOAuth2Api.introspectOAuth2Token.mockRejectedValue(
          Object.assign(new Error('Too many requests'), {
            response: {
              status: 429,
              headers: new Headers({ 'retry-after': '3' }),
            },
          }),
        );

        await expect(validator.introspect(OPAQUE_TOKEN)).rejects.toMatchObject({
          kind: 'rate_limited',
          operation: 'oauth2.introspect',
          retryAfter: 3,
        });
      });

      it('handles token with empty scope string', async () => {
        mockOAuth2Api.introspectOAuth2Token.mockResolvedValue({
          active: true,
          client_id: VALID_CLIENT_ID,
          scope: '',
          sub: VALID_CLIENT_ID,
        });

        const result = await validator.introspect(OPAQUE_TOKEN);

        expect(result.active).toBe(true);
        if (result.active) {
          expect(result.scopes).toEqual([]);
        }
      });

      it('handles token with no scope field', async () => {
        mockOAuth2Api.introspectOAuth2Token.mockResolvedValue({
          active: true,
          client_id: VALID_CLIENT_ID,
          sub: VALID_CLIENT_ID,
        });

        const result = await validator.introspect(OPAQUE_TOKEN);

        expect(result.active).toBe(true);
        if (result.active) {
          expect(result.scopes).toEqual([]);
        }
      });

      it('handles token with no ext field', async () => {
        mockOAuth2Api.introspectOAuth2Token.mockResolvedValue({
          active: true,
          client_id: VALID_CLIENT_ID,
          scope: 'diary:read',
          sub: VALID_CLIENT_ID,
        });

        const result = await validator.introspect(OPAQUE_TOKEN);

        expect(result.active).toBe(true);
        if (result.active) {
          expect(result.ext).toEqual({});
        }
      });

      it('bounds and normalizes provider-controlled scopes', async () => {
        const scopes = [
          ...Array.from({ length: 140 }, (_, index) => `scope:${index}`),
          'x'.repeat(257),
          'scope:0',
        ];
        mockOAuth2Api.introspectOAuth2Token.mockResolvedValue({
          active: true,
          client_id: VALID_CLIENT_ID,
          scope: scopes.join(' '),
          sub: VALID_CLIENT_ID,
        });

        const result = await validator.introspect(OPAQUE_TOKEN);

        expect(result.active && result.scopes).toHaveLength(128);
        expect(result.active && result.scopes[0]).toBe('scope:0');
        expect(result.active && result.scopes.at(-1)).toBe('scope:127');
      });
    });

    describe('resolveAuthContext', () => {
      it('resolves auth context from enriched opaque token', async () => {
        mockOAuth2Api.introspectOAuth2Token.mockResolvedValue({
          active: true,
          client_id: VALID_CLIENT_ID,
          scope: 'diary:read diary:write',
          sub: VALID_CLIENT_ID,
          ext: MOLTNET_EXT_CLAIMS,
        });

        const result = await validator.resolveAuthContext(OPAQUE_TOKEN);
        const cached = await validator.resolveAuthContext(OPAQUE_TOKEN);

        expect(result).toEqual(EXPECTED_AUTH_CONTEXT);
        expect(cached).toEqual(EXPECTED_AUTH_CONTEXT);
        expect(mockOAuth2Api.introspectOAuth2Token).toHaveBeenCalledTimes(1);
      });

      it('uses introspection for opaque tokens even when no JWKS configured', async () => {
        mockOAuth2Api.introspectOAuth2Token.mockResolvedValue({
          active: true,
          client_id: VALID_CLIENT_ID,
          scope: 'diary:read diary:write',
          sub: VALID_CLIENT_ID,
          ext: MOLTNET_EXT_CLAIMS,
        });

        await validator.resolveAuthContext(OPAQUE_TOKEN);

        expect(mockOAuth2Api.introspectOAuth2Token).toHaveBeenCalledWith(
          { token: OPAQUE_TOKEN },
          { signal: expect.any(AbortSignal) },
        );
      });

      it('uses introspection for JWT-shaped tokens when no JWKS configured', async () => {
        // This only covers token-shape routing. Real JWT cryptography and
        // claim enforcement live in token-validator-jwt.test.ts.
        const jwtToken = 'header.payload.signature';
        mockOAuth2Api.introspectOAuth2Token.mockResolvedValue({
          active: true,
          client_id: VALID_CLIENT_ID,
          scope: 'diary:read diary:write',
          sub: VALID_CLIENT_ID,
          ext: MOLTNET_EXT_CLAIMS,
        });

        const result = await validator.resolveAuthContext(jwtToken);

        expect(result).toEqual(EXPECTED_AUTH_CONTEXT);
        expect(mockOAuth2Api.introspectOAuth2Token).toHaveBeenCalled();
      });

      it('falls back to client metadata when token has no ext claims', async () => {
        mockOAuth2Api.introspectOAuth2Token.mockResolvedValue({
          active: true,
          client_id: VALID_CLIENT_ID,
          scope: 'diary:read diary:write',
          sub: VALID_CLIENT_ID,
        });

        mockOAuth2Api.getOAuth2Client.mockResolvedValue({
          client_id: VALID_CLIENT_ID,
          metadata: {
            identity_id: VALID_IDENTITY_ID,
            public_key: 'ed25519:AAAA+/bbbb==',
            fingerprint: 'A1B2-C3D4-E5F6-07A8',
          },
        });

        const result = await validator.resolveAuthContext(OPAQUE_TOKEN);
        const cached = await validator.resolveAuthContext(OPAQUE_TOKEN);

        expect(result).toEqual(EXPECTED_AUTH_CONTEXT);
        expect(cached).toEqual(EXPECTED_AUTH_CONTEXT);
        expect(mockOAuth2Api.getOAuth2Client).toHaveBeenCalledTimes(1);
        expect(mockOAuth2Api.introspectOAuth2Token).toHaveBeenCalledTimes(1);
        expect(mockOAuth2Api.getOAuth2Client).toHaveBeenCalledWith(
          { id: VALID_CLIENT_ID },
          { signal: expect.any(AbortSignal) },
        );
      });

      it('returns null for inactive token', async () => {
        mockOAuth2Api.introspectOAuth2Token.mockResolvedValue({
          active: false,
        });

        const result = await validator.resolveAuthContext(OPAQUE_TOKEN);

        expect(result).toBeNull();
      });

      it('returns null when client metadata is missing identity info', async () => {
        mockOAuth2Api.introspectOAuth2Token.mockResolvedValue({
          active: true,
          client_id: VALID_CLIENT_ID,
          scope: 'diary:read',
          sub: VALID_CLIENT_ID,
        });

        mockOAuth2Api.getOAuth2Client.mockResolvedValue({
          client_id: VALID_CLIENT_ID,
          metadata: {},
        });

        const result = await validator.resolveAuthContext(OPAQUE_TOKEN);

        expect(result).toBeNull();
      });

      it('surfaces provider unavailability and logs safely when client metadata fails', async () => {
        const logger = createMockLogger();
        validator = createTokenValidator(mockOAuth2Api as any, { logger });
        mockOAuth2Api.introspectOAuth2Token.mockResolvedValue({
          active: true,
          client_id: VALID_CLIENT_ID,
          scope: 'diary:read',
          sub: VALID_CLIENT_ID,
        });

        mockOAuth2Api.getOAuth2Client.mockRejectedValue(
          Object.assign(new Error('never-log-this-client-error'), {
            cause: { code: 'ECONNRESET' },
            name: 'ResponseError',
            response: { status: 503 },
          }),
        );

        await expect(
          validator.resolveAuthContext(OPAQUE_TOKEN),
        ).rejects.toMatchObject({
          kind: 'unavailable',
          operation: 'oauth2.client_metadata',
        });
        expect(logger.warn).toHaveBeenCalledWith(
          {
            causeCode: 'ECONNRESET',
            credentialType: 'ory-client-metadata',
            errorType: 'ResponseError',
            reason: 'metadata_lookup_unavailable',
            status: 503,
          },
          'Ory client metadata unavailable',
        );
        const serializedLogs = JSON.stringify(logger.warn.mock.calls);
        expect(serializedLogs).not.toContain(OPAQUE_TOKEN);
        expect(serializedLogs).not.toContain('never-log-this-client-error');
      });

      it('returns null when client_id is missing from introspection', async () => {
        mockOAuth2Api.introspectOAuth2Token.mockResolvedValue({
          active: true,
          scope: 'diary:read',
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
        active: true,
        client_id: VALID_CLIENT_ID,
        scope: 'diary:read',
        sub: VALID_CLIENT_ID,
        ext: MOLTNET_EXT_CLAIMS,
      });

      await validator.resolveAuthContext('ory_at_some_opaque_value');

      expect(mockOAuth2Api.introspectOAuth2Token).toHaveBeenCalledWith(
        { token: 'ory_at_some_opaque_value' },
        { signal: expect.any(AbortSignal) },
      );
    });

    it('routes ory_ht_ prefixed tokens to introspection', async () => {
      mockOAuth2Api.introspectOAuth2Token.mockResolvedValue({
        active: true,
        client_id: VALID_CLIENT_ID,
        scope: 'diary:read',
        sub: VALID_CLIENT_ID,
        ext: MOLTNET_EXT_CLAIMS,
      });

      await validator.resolveAuthContext('ory_ht_some_opaque_value');

      expect(mockOAuth2Api.introspectOAuth2Token).toHaveBeenCalledWith(
        { token: 'ory_ht_some_opaque_value' },
        { signal: expect.any(AbortSignal) },
      );
    });

    it('routes unknown-format tokens to introspection', async () => {
      mockOAuth2Api.introspectOAuth2Token.mockResolvedValue({
        active: false,
      });

      const result = await validator.resolveAuthContext('random_unknown_token');

      expect(result).toBeNull();
      expect(mockOAuth2Api.introspectOAuth2Token).toHaveBeenCalled();
    });

    it('maps a valid Talos agent key onto the existing agent context', async () => {
      const talosApi = createMockTalosApi();
      const resolveTalosAgent = createMockTalosAgentResolver();
      const logger = createMockLogger();
      const onValidationEvent = vi.fn();
      const validator = createTokenValidator(mockOAuth2Api as any, {
        talosApi,
        resolveTalosAgent,
        logger,
        onValidationEvent,
      });
      talosApi.adminVerifyApiKey.mockResolvedValue({
        is_valid: true,
        actor_id: VALID_IDENTITY_ID,
        key_id: 'talos-key-123',
        scopes: ['diary:read'],
        metadata: {
          schema_version: 1,
          subject_type: 'agent',
          team_id: 'team-123',
        },
        status: 'KEY_STATUS_ACTIVE',
        visibility: 'KEY_VISIBILITY_SECRET',
        expire_time: new Date(Date.now() + 60_000),
      });

      const result = await validator.resolveAuthContext('ory_ak_secret');

      expect(result).toEqual({
        subjectType: 'agent',
        agentId: VALID_IDENTITY_ID,
        identityId: VALID_IDENTITY_ID,
        publicKey: 'ed25519:AAAA+/bbbb==',
        fingerprint: 'A1B2-C3D4-E5F6-07A8',
        clientId: 'talos-key-123',
        scopes: ['diary:read'],
        currentTeamId: null,
        credentialBinding: {
          bindingScope: 'team',
          keyId: 'talos-key-123',
          boundTeamId: 'team-123',
        },
      });
      expect(talosApi.adminVerifyApiKey).toHaveBeenCalledWith({
        verifyApiKeyRequest: { credential: 'ory_ak_secret' },
        cacheControl: 'no-store',
        pragma: 'no-cache',
      });
      expect(resolveTalosAgent).toHaveBeenCalledWith(
        VALID_IDENTITY_ID,
        expect.any(AbortSignal),
      );
      expect(mockOAuth2Api.introspectOAuth2Token).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith(
        {
          credentialType: 'talos-api-key',
          reason: 'credential_accepted',
          keyId: 'talos-key-123',
          bindingScope: 'team',
          actorId: VALID_IDENTITY_ID,
          scopeCount: 1,
        },
        'Talos API key accepted',
      );
      expect(JSON.stringify(logger.debug.mock.calls)).not.toContain(
        'ory_ak_secret',
      );
      expect(onValidationEvent).toHaveBeenCalledWith({
        credentialType: 'talos-api-key',
        reason: 'credential_accepted',
        bindingScope: 'team',
        keyId: 'talos-key-123',
      });
    });

    it('caches the complete Talos verification and agent-resolution chain', async () => {
      const talosApi = createMockTalosApi();
      const resolveTalosAgent = createMockTalosAgentResolver();
      const validator = createTokenValidator(mockOAuth2Api as any, {
        talosApi,
        resolveTalosAgent,
      });
      talosApi.adminVerifyApiKey.mockResolvedValue({
        is_valid: true,
        actor_id: VALID_IDENTITY_ID,
        key_id: 'talos-key-123',
        scopes: ['diary:read'],
        metadata: {
          schema_version: 2,
          subject_type: 'agent',
          binding_scope: 'identity',
        },
      });

      await Promise.all([
        validator.resolveAuthContext('ory_ak_secret'),
        validator.resolveAuthContext('ory_ak_secret'),
      ]);
      await validator.resolveAuthContext('ory_ak_secret');

      expect(talosApi.adminVerifyApiKey).toHaveBeenCalledTimes(1);
      expect(resolveTalosAgent).toHaveBeenCalledTimes(1);
    });

    it('rejects a credential Talos reports as invalid', async () => {
      const talosApi = createMockTalosApi();
      const resolveTalosAgent = createMockTalosAgentResolver();
      const logger = createMockLogger();
      const validator = createTokenValidator(mockOAuth2Api as any, {
        talosApi,
        resolveTalosAgent,
        logger,
      });
      talosApi.adminVerifyApiKey.mockResolvedValue({
        is_valid: false,
        error_code: 'API_KEY_REVOKED',
      });

      const result = await validator.resolveAuthContext('ory_ak_revoked');

      expect(result).toBeNull();
      expect(resolveTalosAgent).not.toHaveBeenCalled();
      expect(mockOAuth2Api.introspectOAuth2Token).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith(
        {
          credentialType: 'talos-api-key',
          reason: 'credential_rejected',
          errorCode: 'API_KEY_REVOKED',
          status: undefined,
        },
        'Talos API key rejected',
      );
    });

    it('fails closed and logs the HTTP status on verifier errors', async () => {
      const talosApi = createMockTalosApi();
      const resolveTalosAgent = createMockTalosAgentResolver();
      const logger = createMockLogger();
      const validator = createTokenValidator(mockOAuth2Api as any, {
        talosApi,
        resolveTalosAgent,
        logger,
      });
      talosApi.adminVerifyApiKey.mockRejectedValue(
        Object.assign(new Error('Talos offline'), {
          name: 'ResponseError',
          response: { status: 503 },
        }),
      );

      await expect(
        validator.resolveAuthContext('ory_ak_secret'),
      ).rejects.toMatchObject({
        kind: 'unavailable',
        operation: 'talos.verify',
      });
      expect(mockOAuth2Api.introspectOAuth2Token).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        {
          credentialType: 'talos-api-key',
          reason: 'verifier_request_failed',
          errorType: 'ResponseError',
          status: 503,
        },
        'Talos API key validation unavailable',
      );
      expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(
        'ory_ak_secret',
      );
    });

    it('rejects Talos keys whose actor has no canonical active agent', async () => {
      const talosApi = createMockTalosApi();
      const resolveTalosAgent = vi.fn().mockResolvedValue(null);
      const logger = createMockLogger();
      const validator = createTokenValidator(mockOAuth2Api as any, {
        talosApi,
        resolveTalosAgent,
        logger,
      });
      talosApi.adminVerifyApiKey.mockResolvedValue({
        is_valid: true,
        actor_id: VALID_IDENTITY_ID,
        key_id: 'talos-key-123',
        metadata: {
          schema_version: 2,
          subject_type: 'agent',
          binding_scope: 'identity',
        },
      });

      const result = await validator.resolveAuthContext('ory_ak_secret');

      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        {
          credentialType: 'talos-api-key',
          reason: 'agent_not_found_or_inactive',
          keyId: 'talos-key-123',
          actorId: VALID_IDENTITY_ID,
        },
        'Talos API key actor rejected',
      );
      expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(
        'ory_ak_secret',
      );
    });

    it('falls back to introspection when Talos is not configured', async () => {
      const logger = createMockLogger();
      const validator = createTokenValidator(mockOAuth2Api as any, { logger });
      mockOAuth2Api.introspectOAuth2Token.mockResolvedValue({ active: false });

      const result = await validator.resolveAuthContext('ory_ak_secret');

      expect(result).toBeNull();
      expect(mockOAuth2Api.introspectOAuth2Token).toHaveBeenCalledWith(
        { token: 'ory_ak_secret' },
        { signal: expect.any(AbortSignal) },
      );
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('rejects a key Talos reports as revoked', async () => {
      const talosApi = createMockTalosApi();
      const resolveTalosAgent = createMockTalosAgentResolver();
      const logger = createMockLogger();
      const validator = createTokenValidator(mockOAuth2Api as any, {
        talosApi,
        resolveTalosAgent,
        logger,
      });
      talosApi.adminVerifyApiKey.mockResolvedValue({
        is_valid: false,
        error_code: 'VERIFICATION_ERROR_REVOKED',
      });

      const result = await validator.resolveAuthContext('ory_ak_revoked');

      expect(result).toBeNull();
      expect(resolveTalosAgent).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith(
        {
          credentialType: 'talos-api-key',
          reason: 'credential_rejected',
          errorCode: 'VERIFICATION_ERROR_REVOKED',
          status: undefined,
        },
        'Talos API key rejected',
      );
    });

    it('rejects public-visibility keys before resolving the actor', async () => {
      const talosApi = createMockTalosApi();
      const resolveTalosAgent = createMockTalosAgentResolver();
      const validator = createTokenValidator(mockOAuth2Api as any, {
        talosApi,
        resolveTalosAgent,
      });
      talosApi.adminVerifyApiKey.mockResolvedValue({
        is_valid: true,
        actor_id: VALID_IDENTITY_ID,
        key_id: 'talos-public-123',
        visibility: 'KEY_VISIBILITY_PUBLIC',
      });

      const result = await validator.resolveAuthContext('ory_ak_public');

      expect(result).toBeNull();
      expect(resolveTalosAgent).not.toHaveBeenCalled();
    });
  });
});
