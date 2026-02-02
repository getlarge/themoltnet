/**
 * HMAC-based challenge signing and verification
 *
 * Used for stateless recovery challenges — the server signs a challenge
 * with a secret so it can verify authenticity without storing anything.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

const RECOVERY_CHALLENGE_PREFIX = 'moltnet:recovery';

/**
 * Generate a recovery challenge string with embedded timestamp.
 *
 * Format: moltnet:recovery:{32 bytes random hex}:{unix timestamp ms}
 */
export function generateRecoveryChallenge(): string {
  const nonce = randomBytes(32).toString('hex');
  const timestamp = Date.now();
  return `${RECOVERY_CHALLENGE_PREFIX}:${nonce}:${timestamp}`;
}

/**
 * HMAC-sign a challenge string using the server secret.
 * Returns the hex-encoded HMAC-SHA256.
 */
export function signChallenge(challenge: string, secret: string): string {
  return createHmac('sha256', secret).update(challenge).digest('hex');
}

/**
 * Verify a challenge's HMAC and check that it hasn't expired.
 *
 * Returns `{ valid: true }` or `{ valid: false, reason: string }`.
 */
export function verifyChallenge(
  challenge: string,
  hmac: string,
  secret: string,
  maxAgeMs: number,
): { valid: true } | { valid: false; reason: string } {
  // Verify the challenge format
  const parts = challenge.split(':');
  if (parts.length !== 4 || parts[0] !== 'moltnet' || parts[1] !== 'recovery') {
    return { valid: false, reason: 'Invalid challenge format' };
  }

  // Verify HMAC (timing-safe comparison)
  const expected = signChallenge(challenge, secret);
  const expectedBuf = Buffer.from(expected, 'hex');
  const actualBuf = Buffer.from(hmac, 'hex');
  if (expectedBuf.length !== actualBuf.length) {
    return { valid: false, reason: 'Invalid HMAC' };
  }
  if (!timingSafeEqual(expectedBuf, actualBuf)) {
    return { valid: false, reason: 'Invalid HMAC' };
  }

  // Verify timestamp freshness
  const timestamp = parseInt(parts[3], 10);
  if (isNaN(timestamp)) {
    return { valid: false, reason: 'Invalid challenge timestamp' };
  }
  const age = Date.now() - timestamp;
  if (age > maxAgeMs) {
    return { valid: false, reason: 'Challenge expired' };
  }
  if (age < 0) {
    return { valid: false, reason: 'Challenge timestamp is in the future' };
  }

  return { valid: true };
}
