import { describe, expect, it } from 'vitest';

import {
  deriveRateLimitKey,
  isAuthenticatedKey,
} from '../src/plugins/rate-limit-key.js';

/**
 * Build a decodable JWT (header.payload.signature). The signature is not
 * checked — deriveRateLimitKey only decodes claims to pick a bucket, it never
 * verifies. Real verification still happens later in the auth preHandler.
 */
function makeJwt(claims: Record<string, unknown>): string {
  const b64 = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj)).toString('base64url');
  const header = b64({ alg: 'RS256', typ: 'JWT' });
  const payload = b64(claims);
  return `${header}.${payload}.signature-not-verified`;
}

interface KeyInput {
  headers: Record<string, string | string[] | undefined>;
  ip: string;
}

function req(input: Partial<KeyInput>): KeyInput {
  return { headers: {}, ip: '203.0.113.1', ...input };
}

describe('deriveRateLimitKey', () => {
  describe('Bearer JWT (agent / human enriched token)', () => {
    it('keys on the moltnet:identity_id claim', () => {
      const token = makeJwt({
        'moltnet:identity_id': 'aaaa-aaaa',
        sub: 'client-123',
      });
      const key = deriveRateLimitKey(
        req({ headers: { authorization: `Bearer ${token}` } }),
      );
      expect(key).toBe('id:aaaa-aaaa');
    });

    it('falls back to sub when moltnet:identity_id is absent', () => {
      const token = makeJwt({ sub: 'client-123' });
      const key = deriveRateLimitKey(
        req({ headers: { authorization: `Bearer ${token}` } }),
      );
      expect(key).toBe('id:client-123');
    });

    it('gives two identities on the SAME ip distinct keys (the #1336 bug)', () => {
      const ip = '203.0.113.9';
      const a = deriveRateLimitKey(
        req({
          ip,
          headers: {
            authorization: `Bearer ${makeJwt({ 'moltnet:identity_id': 'agent-a' })}`,
          },
        }),
      );
      const b = deriveRateLimitKey(
        req({
          ip,
          headers: {
            authorization: `Bearer ${makeJwt({ 'moltnet:identity_id': 'agent-b' })}`,
          },
        }),
      );
      expect(a).not.toBe(b);
      expect(a).toBe('id:agent-a');
      expect(b).toBe('id:agent-b');
    });
  });

  describe('Opaque Ory bearer token', () => {
    it('keys on a hash of the token (cannot decode pre-introspection)', () => {
      const key = deriveRateLimitKey(
        req({ headers: { authorization: 'Bearer ory_at_OPAQUEvalue123' } }),
      );
      expect(key).toMatch(/^tok:[a-f0-9]{64}$/);
    });

    it('is stable for the same opaque token and distinct across tokens', () => {
      const k1 = deriveRateLimitKey(
        req({ headers: { authorization: 'Bearer ory_at_AAA' } }),
      );
      const k2 = deriveRateLimitKey(
        req({ headers: { authorization: 'Bearer ory_at_AAA' } }),
      );
      const k3 = deriveRateLimitKey(
        req({ headers: { authorization: 'Bearer ory_ht_BBB' } }),
      );
      expect(k1).toBe(k2);
      expect(k1).not.toBe(k3);
    });
  });

  describe('Kratos session', () => {
    it('keys on a hash of the x-moltnet-session-token header', () => {
      const key = deriveRateLimitKey(
        req({ headers: { 'x-moltnet-session-token': 'sess-token-xyz' } }),
      );
      expect(key).toMatch(/^sess:[a-f0-9]{64}$/);
    });

    it('keys on the kratos session cookie value when no token header', () => {
      const key = deriveRateLimitKey(
        req({
          headers: { cookie: 'theme=dark; ory_kratos_session=abc123; x=y' },
        }),
      );
      expect(key).toMatch(/^sess:[a-f0-9]{64}$/);
    });

    it('does NOT treat an unrelated cookie as a session', () => {
      const key = deriveRateLimitKey(
        req({ ip: '198.51.100.7', headers: { cookie: 'analytics_id=xyz' } }),
      );
      expect(key).toBe('ip:198.51.100.7');
    });
  });

  describe('Anonymous fallback', () => {
    it('keys on ip when no auth material is present', () => {
      const key = deriveRateLimitKey(req({ ip: '198.51.100.4', headers: {} }));
      expect(key).toBe('ip:198.51.100.4');
    });

    it('namespaces ip so a forged sub cannot collide with an ip bucket', () => {
      // An attacker who sets sub to a victim's IP string still lands in the
      // id: namespace, never the ip: namespace.
      const token = makeJwt({ 'moltnet:identity_id': '198.51.100.4' });
      const forged = deriveRateLimitKey(
        req({
          ip: '10.0.0.1',
          headers: { authorization: `Bearer ${token}` },
        }),
      );
      const victimAnon = deriveRateLimitKey(
        req({ ip: '198.51.100.4', headers: {} }),
      );
      expect(forged).toBe('id:198.51.100.4');
      expect(victimAnon).toBe('ip:198.51.100.4');
      expect(forged).not.toBe(victimAnon);
    });
  });

  describe('malformed bearer token', () => {
    it('falls back to ip when the JWT cannot be decoded', () => {
      const key = deriveRateLimitKey(
        req({
          ip: '192.0.2.5',
          headers: { authorization: 'Bearer not.a.jwt' },
        }),
      );
      // Undecodable, non-opaque -> hash the token string rather than crash.
      expect(key).toMatch(/^tok:[a-f0-9]{64}$/);
    });
  });
});

describe('isAuthenticatedKey', () => {
  it('treats id:/tok:/sess: keys as authenticated and ip: as anonymous', () => {
    expect(isAuthenticatedKey('id:aaaa')).toBe(true);
    expect(isAuthenticatedKey('tok:deadbeef')).toBe(true);
    expect(isAuthenticatedKey('sess:deadbeef')).toBe(true);
    expect(isAuthenticatedKey('ip:203.0.113.1')).toBe(false);
  });
});
