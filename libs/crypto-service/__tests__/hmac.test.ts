import { describe, expect, it } from 'vitest';

import {
  generateRecoveryChallenge,
  signChallenge,
  verifyChallenge,
} from '../src/index.js';

const TEST_SECRET = 'test-recovery-secret-for-hmac-tests';
const FIVE_MINUTES_MS = 5 * 60 * 1000;

describe('HMAC challenge utilities', () => {
  describe('generateRecoveryChallenge', () => {
    it('produces a challenge in the expected format', () => {
      const challenge = generateRecoveryChallenge();
      const parts = challenge.split(':');
      expect(parts).toHaveLength(4);
      expect(parts[0]).toBe('moltnet');
      expect(parts[1]).toBe('recovery');
      expect(parts[2]).toMatch(/^[a-f0-9]{64}$/);
      expect(Number(parts[3])).toBeGreaterThan(0);
    });

    it('produces unique challenges on successive calls', () => {
      const a = generateRecoveryChallenge();
      const b = generateRecoveryChallenge();
      expect(a).not.toBe(b);
    });
  });

  describe('signChallenge', () => {
    it('produces deterministic output for same inputs', () => {
      const challenge = 'moltnet:recovery:abc123:1700000000000';
      const hmac1 = signChallenge(challenge, TEST_SECRET);
      const hmac2 = signChallenge(challenge, TEST_SECRET);
      expect(hmac1).toBe(hmac2);
    });

    it('produces different output for different secrets', () => {
      const challenge = 'moltnet:recovery:abc123:1700000000000';
      const hmac1 = signChallenge(challenge, 'secret-a');
      const hmac2 = signChallenge(challenge, 'secret-b');
      expect(hmac1).not.toBe(hmac2);
    });

    it('returns a hex-encoded string', () => {
      const challenge = generateRecoveryChallenge();
      const hmac = signChallenge(challenge, TEST_SECRET);
      expect(hmac).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('verifyChallenge', () => {
    it('accepts a valid challenge within TTL', () => {
      const challenge = generateRecoveryChallenge();
      const hmac = signChallenge(challenge, TEST_SECRET);

      const result = verifyChallenge(
        challenge,
        hmac,
        TEST_SECRET,
        FIVE_MINUTES_MS,
      );
      expect(result).toEqual({ valid: true });
    });

    it('rejects a tampered challenge', () => {
      const challenge = generateRecoveryChallenge();
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
      const challenge = generateRecoveryChallenge();
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
      const challenge = generateRecoveryChallenge();
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
      const challenge = `moltnet:recovery:${'a'.repeat(64)}:${sixMinutesAgo}`;
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
      const challenge = `moltnet:recovery:${'a'.repeat(64)}:${future}`;
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
      const challenge = generateRecoveryChallenge();
      const hmac = signChallenge(challenge, TEST_SECRET);
      const result = verifyChallenge(
        challenge,
        hmac,
        TEST_SECRET,
        FIVE_MINUTES_MS,
      );
      expect(result).toEqual({ valid: true });
    });
  });
});
