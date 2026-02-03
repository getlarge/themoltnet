/**
 * HMAC-based challenge signing and verification
 *
 * Used for stateless recovery challenges — the server signs a challenge
 * with a secret so it can verify authenticity without storing anything.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

const RECOVERY_CHALLENGE_PREFIX = 'moltnet:recovery';

/**
 * Generate a recovery challenge string bound to a specific public key.
 *
 * Format: moltnet:recovery:{publicKey}:{32 bytes random hex}:{unix timestamp ms}
 *
 * Binding the public key into the challenge (and therefore the HMAC)
 * ensures the signed challenge can only be used by the intended agent.
 */
export function generateRecoveryChallenge(publicKey: string): string {
  const nonce = randomBytes(32).toString('hex');
  const timestamp = Date.now();
  return `${RECOVERY_CHALLENGE_PREFIX}:${publicKey}:${nonce}:${timestamp}`;
}

/**
 * HMAC-sign a challenge string using the server secret.
 * Returns the hex-encoded HMAC-SHA256.
 */
export function signChallenge(challenge: string, secret: string): string {
  return createHmac('sha256', secret).update(challenge).digest('hex');
}

/**
 * Verify a challenge's HMAC, public key binding, and TTL.
 *
 * Expected format: moltnet:recovery:ed25519:{keyData}:{nonce}:{timestamp}
 * (6 colon-separated parts because the public key contains one colon)
 *
 * Returns `{ valid: true }` or `{ valid: false, reason: string }`.
 */
export function verifyChallenge(
  challenge: string,
  hmac: string,
  secret: string,
  maxAgeMs: number,
  expectedPublicKey?: string,
): { valid: true } | { valid: false; reason: string } {
  // Verify the challenge format
  // 6 parts: moltnet : recovery : ed25519 : keyData : nonce : timestamp
  const parts = challenge.split(':');
  if (
    parts.length !== 6 ||
    parts[0] !== 'moltnet' ||
    parts[1] !== 'recovery' ||
    parts[2] !== 'ed25519'
  ) {
    return { valid: false, reason: 'Invalid challenge format' };
  }

  // If caller provides a public key, verify it matches the embedded one
  if (expectedPublicKey) {
    const embeddedKey = `${parts[2]}:${parts[3]}`;
    if (embeddedKey !== expectedPublicKey) {
      return {
        valid: false,
        reason: 'Challenge was issued for a different key',
      };
    }
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
  const timestamp = parseInt(parts[5], 10);
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
