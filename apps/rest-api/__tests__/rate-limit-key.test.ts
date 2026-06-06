import { describe, expect, it } from 'vitest';

import {
  deriveRateLimitKey,
  isAuthenticatedKey,
} from '../src/plugins/rate-limit-key.js';

/**
 * Build a JWT-shaped token (header.payload.signature). deriveRateLimitKey does
 * NOT decode or trust the payload — it keys on a hash of the whole token byte
 * string — so the claims only matter for the anti-forgery test below, which
 * proves a chosen identity claim does NOT influence the bucket.
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
  describe('Bearer token (JWT or opaque) — keyed on token bytes, not claims', () => {
    it('keys on a hash of the token, namespaced tok:', () => {
      const key = deriveRateLimitKey(
        req({
          headers: {
            authorization: `Bearer ${makeJwt({ 'moltnet:identity_id': 'a' })}`,
          },
        }),
      );
      expect(key).toMatch(/^tok:[a-f0-9]{64}$/);
    });

    it('is stable for the same token and distinct across different tokens', () => {
      const t1 = makeJwt({ 'moltnet:identity_id': 'a' });
      const t2 = makeJwt({ 'moltnet:identity_id': 'b' });
      const k1 = deriveRateLimitKey(
        req({ headers: { authorization: `Bearer ${t1}` } }),
      );
      const k1again = deriveRateLimitKey(
        req({ headers: { authorization: `Bearer ${t1}` } }),
      );
      const k2 = deriveRateLimitKey(
        req({ headers: { authorization: `Bearer ${t2}` } }),
      );
      expect(k1).toBe(k1again);
      expect(k1).not.toBe(k2);
    });

    it('gives two distinct tokens on the same IP separate keys (the #1336 IP-collapse bug)', () => {
      const ip = '203.0.113.9';
      const a = deriveRateLimitKey(
        req({
          ip,
          headers: { authorization: `Bearer ${makeJwt({ sub: 'agent-a' })}` },
        }),
      );
      const b = deriveRateLimitKey(
        req({
          ip,
          headers: { authorization: `Bearer ${makeJwt({ sub: 'agent-b' })}` },
        }),
      );
      expect(a).not.toBe(b);
    });

    it('keys opaque Ory tokens on the token hash too', () => {
      const key = deriveRateLimitKey(
        req({ headers: { authorization: 'Bearer ory_at_OPAQUEvalue123' } }),
      );
      expect(key).toMatch(/^tok:[a-f0-9]{64}$/);
    });
  });

  describe('Anti-forgery: a chosen identity claim cannot target a victim bucket (#1336 review)', () => {
    it('does NOT let an attacker land in a victim’s bucket by setting moltnet:identity_id', () => {
      // The victim's own (valid) token.
      const victimToken = makeJwt({ 'moltnet:identity_id': 'victim-123' });
      const victimKey = deriveRateLimitKey(
        req({
          ip: '10.0.0.1',
          headers: { authorization: `Bearer ${victimToken}` },
        }),
      );

      // An attacker forges a DIFFERENT token that merely *claims* the victim's id.
      const forgedToken = makeJwt({ 'moltnet:identity_id': 'victim-123' });
      // (different signature segment guarantees different bytes)
      const forgedToken2 = `${forgedToken}-attacker`;
      const forgedKey = deriveRateLimitKey(
        req({
          ip: '10.0.0.2',
          headers: { authorization: `Bearer ${forgedToken2}` },
        }),
      );

      // Because keys are token-byte hashes, the forged token CANNOT collide with
      // the victim's bucket — the attacker can only exhaust their own token.
      expect(forgedKey).not.toBe(victimKey);
    });

    it('an attacker cannot fabricate the victim’s token bytes', () => {
      // The only way to land in victim-123's bucket is to present the victim's
      // exact token bytes — which the attacker does not have. Same claim, same
      // IP, but a different token string ⇒ different bucket.
      const tokenA = makeJwt({ 'moltnet:identity_id': 'victim-123', jti: '1' });
      const tokenB = makeJwt({ 'moltnet:identity_id': 'victim-123', jti: '2' });
      const ip = '198.51.100.1';
      const keyA = deriveRateLimitKey(
        req({ ip, headers: { authorization: `Bearer ${tokenA}` } }),
      );
      const keyB = deriveRateLimitKey(
        req({ ip, headers: { authorization: `Bearer ${tokenB}` } }),
      );
      expect(keyA).not.toBe(keyB);
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

    it('namespaces ip so a token-hash can never collide with an ip bucket', () => {
      const tokKey = deriveRateLimitKey(
        req({ headers: { authorization: 'Bearer anything' } }),
      );
      const ipKey = deriveRateLimitKey(
        req({ ip: '198.51.100.4', headers: {} }),
      );
      expect(tokKey.startsWith('tok:')).toBe(true);
      expect(ipKey.startsWith('ip:')).toBe(true);
      expect(tokKey).not.toBe(ipKey);
    });
  });

  describe('malformed bearer token', () => {
    it('still keys on the token bytes for a non-JWT bearer value', () => {
      const key = deriveRateLimitKey(
        req({
          ip: '192.0.2.5',
          headers: { authorization: 'Bearer not.a.jwt' },
        }),
      );
      expect(key).toMatch(/^tok:[a-f0-9]{64}$/);
    });

    it('falls back to ip when the Authorization header is not a Bearer scheme', () => {
      const key = deriveRateLimitKey(
        req({ ip: '192.0.2.6', headers: { authorization: 'Basic abc' } }),
      );
      expect(key).toBe('ip:192.0.2.6');
    });
  });
});

describe('isAuthenticatedKey', () => {
  it('treats tok:/sess: keys as authenticated and ip: as anonymous', () => {
    expect(isAuthenticatedKey('tok:deadbeef')).toBe(true);
    expect(isAuthenticatedKey('sess:deadbeef')).toBe(true);
    expect(isAuthenticatedKey('ip:203.0.113.1')).toBe(false);
  });
});
