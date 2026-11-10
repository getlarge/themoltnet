import { OAuthError, OAuthErrorCode } from '@modelcontextprotocol/server';
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWTVerifyGetKey,
  SignJWT,
} from 'jose';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { createHydraTokenVerifier } from '../src/hydra-token-verifier.js';

const INTROSPECTION = {
  endpoint: 'http://hydra-admin.test/admin/oauth2/introspect',
  bearerToken: 'admin-key',
};

let keySet: JWTVerifyGetKey;
let privateKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' };
  keySet = createLocalJWKSet({ keys: [jwk] });
});

async function signToken(claims: Record<string, unknown>): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey);
}

function introspectionResponse(body: unknown, status = 200): typeof fetch {
  return vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

describe('createHydraTokenVerifier', () => {
  it('maps a verified Hydra JWT to AuthInfo', async () => {
    // Arrange
    const token = await signToken({
      sub: 'identity-1',
      client_id: 'client-1',
      scp: ['openid', 'diary:read'],
      ext: { 'moltnet:subject_type': 'human' },
    });
    const verifier = createHydraTokenVerifier({ keySet });

    // Act
    const info = await verifier.verifyAccessToken(token);

    // Assert
    expect(info).toMatchObject({
      token,
      clientId: 'client-1',
      scopes: ['openid', 'diary:read'],
      extra: { sub: 'identity-1', ext: { 'moltnet:subject_type': 'human' } },
    });
    expect(info.expiresAt).toEqual(expect.any(Number));
  });

  it('reads a space-separated scope claim', async () => {
    const token = await signToken({ client_id: 'c', scope: 'a:b c:d' });
    const verifier = createHydraTokenVerifier({ keySet });

    const info = await verifier.verifyAccessToken(token);

    expect(info.scopes).toEqual(['a:b', 'c:d']);
  });

  it('falls back to introspection when the JWT does not verify', async () => {
    // Arrange
    const fetchImpl = introspectionResponse({
      active: true,
      sub: 'identity-2',
      client_id: 'client-2',
      scope: 'openid diary:read',
      exp: 2_000_000_000,
    });
    const onJwtFailure = vi.fn();
    const verifier = createHydraTokenVerifier({
      keySet,
      introspection: INTROSPECTION,
      onJwtFailure,
      fetch: fetchImpl,
    });

    // Act
    const info = await verifier.verifyAccessToken('opaque-token');

    // Assert
    expect(onJwtFailure).toHaveBeenCalledOnce();
    expect(info).toMatchObject({
      token: 'opaque-token',
      clientId: 'client-2',
      scopes: ['openid', 'diary:read'],
      expiresAt: 2_000_000_000,
    });
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0]!;
    expect(url).toBe(INTROSPECTION.endpoint);
    expect(new Headers(init?.headers).get('authorization')).toBe(
      'Bearer admin-key',
    );
    expect(String(init?.body)).toContain('token=opaque-token');
  });

  it('rejects an inactive token as invalid_token', async () => {
    const verifier = createHydraTokenVerifier({
      introspection: INTROSPECTION,
      fetch: introspectionResponse({ active: false }),
    });

    const result = verifier.verifyAccessToken('revoked');

    await expect(result).rejects.toBeInstanceOf(OAuthError);
    await expect(result).rejects.toMatchObject({
      code: OAuthErrorCode.InvalidToken,
    });
  });

  it('rejects when introspection answers an error status', async () => {
    const verifier = createHydraTokenVerifier({
      introspection: INTROSPECTION,
      fetch: introspectionResponse({}, 401),
    });

    await expect(verifier.verifyAccessToken('t')).rejects.toMatchObject({
      code: OAuthErrorCode.InvalidToken,
    });
  });

  it('reports a server error when introspection is unreachable', async () => {
    const verifier = createHydraTokenVerifier({
      introspection: INTROSPECTION,
      fetch: vi.fn<typeof fetch>().mockRejectedValue(new Error('ECONNREFUSED')),
    });

    await expect(verifier.verifyAccessToken('t')).rejects.toMatchObject({
      code: OAuthErrorCode.ServerError,
    });
  });

  it('rejects a bad JWT when no introspection is configured', async () => {
    const verifier = createHydraTokenVerifier({ keySet });

    await expect(verifier.verifyAccessToken('not-a-jwt')).rejects.toMatchObject(
      { code: OAuthErrorCode.InvalidToken },
    );
  });
});
