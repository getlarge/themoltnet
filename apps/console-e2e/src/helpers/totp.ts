import { createHmac } from 'node:crypto';

/**
 * Minimal RFC 6238 TOTP generator.
 *
 * Kratos hands out a base32 secret when an identity enrols an authenticator
 * app; producing valid codes for it is the only way an automated test can move
 * a session from aal1 to aal2. Hand-rolled rather than pulling a dependency —
 * the algorithm is thirty lines and this is the only consumer.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TIME_STEP_SECONDS = 30;
const DIGITS = 6;

function base32Decode(input: string): Buffer {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const char of input.replace(/=+$/, '').toUpperCase()) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

/** Generates the TOTP code valid at `atMs` for a base32 secret. */
export function generateTotpCode(secret: string, atMs = Date.now()): string {
  const counter = Math.floor(atMs / 1000 / TIME_STEP_SECONDS);
  const counterBytes = Buffer.alloc(8);
  counterBytes.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  counterBytes.writeUInt32BE(counter >>> 0, 4);

  const digest = createHmac('sha1', base32Decode(secret))
    .update(counterBytes)
    .digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const truncated =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];

  return String(truncated % 10 ** DIGITS).padStart(DIGITS, '0');
}

/**
 * Waits out the current TOTP window when it is nearly over.
 *
 * Kratos rejects a code that expires between generation and validation, which
 * is a real risk when the code is minted right on a step boundary.
 */
export async function waitForFreshTotpWindow(
  minRemainingSeconds = 3,
): Promise<void> {
  const elapsed = (Date.now() / 1000) % TIME_STEP_SECONDS;
  const remaining = TIME_STEP_SECONDS - elapsed;
  if (remaining >= minRemainingSeconds) return;
  await new Promise((resolve) => {
    setTimeout(resolve, (remaining + 0.25) * 1000);
  });
}
