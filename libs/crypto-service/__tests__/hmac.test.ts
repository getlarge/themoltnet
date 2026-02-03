import { describe, expect, it } from 'vitest';

import {
  generateRecoveryChallenge,
  signChallenge,
  verifyChallenge,
} from '../src/index.js';

const TEST_SECRET = 'test-recovery-secret-for-hmac-tests';
const TEST_PUBLIC_KEY = 'ed25519:AAAA+/bbbb==';
const FIVE_MINUTES_MS = 5 * 60 * 1000;

describe('HMAC challenge utilities', () => {
  describe('generateRecoveryChallenge', () => {
    it('produces a challenge in the expected format', () => {
      const challenge = generateRecoveryChallenge(TEST_PUBLIC_KEY);
      const parts = challenge.split(':');
      expect(parts).toHaveLength(6);
      expect(parts[0]).toBe('moltnet');
      expect(parts[1]).toBe('recovery');
      // parts[2]:parts[3] = ed25519:keyData
      expect(`${parts[2]}:${parts[3]}`).toBe(TEST_PUBLIC_KEY);
      expect(parts[4]).toMatch(/^[a-f0-9]{64}$/);
      expect(Number(parts[5])).toBeGreaterThan(0);
    });

    it('produces unique challenges on successive calls', () => {
      const a = generateRecoveryChallenge(TEST_PUBLIC_KEY);
      const b = generateRecoveryChallenge(TEST_PUBLIC_KEY);
      expect(a).not.toBe(b);
    });
  });

  describe('signChallenge', () => {
    it('produces deterministic output for same inputs', () => {
      const challenge =
        'moltnet:recovery:ed25519:key:' + 'a'.repeat(64) + ':1700000000000';
      const hmac1 = signChallenge(challenge, TEST_SECRET);
      const hmac2 = signChallenge(challenge, TEST_SECRET);
      expect(hmac1).toBe(hmac2);
    });

    it('produces different output for different secrets', () => {
      const challenge =
        'moltnet:recovery:ed25519:key:' + 'a'.repeat(64) + ':1700000000000';
      const hmac1 = signChallenge(challenge, 'secret-a');
      const hmac2 = signChallenge(challenge, 'secret-b');
      expect(hmac1).not.toBe(hmac2);
    });

    it('returns a hex-encoded string', () => {
      const challenge = generateRecoveryChallenge(TEST_PUBLIC_KEY);
      const hmac = signChallenge(challenge, TEST_SECRET);
      expect(hmac).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('verifyChallenge', () => {
    it('accepts a valid challenge within TTL', () => {
      const challenge = generateRecoveryChallenge(TEST_PUBLIC_KEY);
      const hmac = signChallenge(challenge, TEST_SECRET);

      const result = verifyChallenge(
        challenge,
        hmac,
        TEST_SECRET,
        FIVE_MINUTES_MS,
      );
      expect(result).toEqual({ valid: true });
    });

    it('accepts when expectedPublicKey matches embedded key', () => {
      const challenge = generateRecoveryChallenge(TEST_PUBLIC_KEY);
      const hmac = signChallenge(challenge, TEST_SECRET);

      const result = verifyChallenge(
        challenge,
        hmac,
        TEST_SECRET,
        FIVE_MINUTES_MS,
        TEST_PUBLIC_KEY,
      );
      expect(result).toEqual({ valid: true });
    });

    it('rejects when expectedPublicKey differs from embedded key', () => {
      const challenge = generateRecoveryChallenge(TEST_PUBLIC_KEY);
      const hmac = signChallenge(challenge, TEST_SECRET);

      const result = verifyChallenge(
        challenge,
        hmac,
        TEST_SECRET,
        FIVE_MINUTES_MS,
        'ed25519:OtherKeyData==',
      );
      expect(result.valid).toBe(false);
      expect(result).toHaveProperty(
        'reason',
        'Challenge was issued for a different key',
      );
    });

    it('rejects a tampered challenge', () => {
      const challenge = generateRecoveryChallenge(TEST_PUBLIC_KEY);
      const hmac = signChallenge(challenge, TEST_SECRET);
      const tampered = challenge.replace('moltnet', 'tampered');

      const result = verifyChallenge(
        tampered,
        hmac,
        TEST_SECRET,
        FIVE_MINUTES_MS,
      );
      expect(result.valid).toBe(false);
    });

    it('rejects a tampered HMAC', () => {
      const challenge = generateRecoveryChallenge(TEST_PUBLIC_KEY);
      const hmac = signChallenge(challenge, TEST_SECRET);
      const tamperedHmac = hmac.replace(hmac[0], hmac[0] === 'a' ? 'b' : 'a');

      const result = verifyChallenge(
        challenge,
        tamperedHmac,
        TEST_SECRET,
        FIVE_MINUTES_MS,
      );
      expect(result.valid).toBe(false);
    });

    it('rejects a challenge signed with a different secret', () => {
      const challenge = generateRecoveryChallenge(TEST_PUBLIC_KEY);
      const hmac = signChallenge(challenge, 'wrong-secret');

      const result = verifyChallenge(
        challenge,
        hmac,
        TEST_SECRET,
        FIVE_MINUTES_MS,
      );
      expect(result.valid).toBe(false);
    });

    it('rejects an expired challenge', () => {
      const sixMinutesAgo = Date.now() - 6 * 60 * 1000;
      const challenge = `moltnet:recovery:ed25519:key:${'a'.repeat(64)}:${sixMinutesAgo}`;
      const hmac = signChallenge(challenge, TEST_SECRET);

      const result = verifyChallenge(
        challenge,
        hmac,
        TEST_SECRET,
        FIVE_MINUTES_MS,
      );
      expect(result.valid).toBe(false);
      expect(result).toHaveProperty('reason', 'Challenge expired');
    });

    it('rejects a challenge with a future timestamp', () => {
      const future = Date.now() + 60_000;
      const challenge = `moltnet:recovery:ed25519:key:${'a'.repeat(64)}:${future}`;
      const hmac = signChallenge(challenge, TEST_SECRET);

      const result = verifyChallenge(
        challenge,
        hmac,
        TEST_SECRET,
        FIVE_MINUTES_MS,
      );
      expect(result.valid).toBe(false);
      expect(result).toHaveProperty(
        'reason',
        'Challenge timestamp is in the future',
      );
    });

    it('rejects an invalid challenge format', () => {
      const challenge = 'bad:format';
      const hmac = signChallenge(challenge, TEST_SECRET);

      const result = verifyChallenge(
        challenge,
        hmac,
        TEST_SECRET,
        FIVE_MINUTES_MS,
      );
      expect(result.valid).toBe(false);
      expect(result).toHaveProperty('reason', 'Invalid challenge format');
    });

    it('round-trip: generate, sign, verify succeeds', () => {
      const challenge = generateRecoveryChallenge(TEST_PUBLIC_KEY);
      const hmac = signChallenge(challenge, TEST_SECRET);
      const result = verifyChallenge(
        challenge,
        hmac,
        TEST_SECRET,
        FIVE_MINUTES_MS,
        TEST_PUBLIC_KEY,
      );
      expect(result).toEqual({ valid: true });
    });
  });
});
