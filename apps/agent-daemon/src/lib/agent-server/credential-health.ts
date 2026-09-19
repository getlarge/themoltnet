import type { CredentialMetadata } from './team-credentials.js';

/** Display only: never authorizes a request or replaces live verification. */
export function credentialHealth(
  credential: CredentialMetadata | undefined,
  available: boolean,
  now = Date.now(),
): 'healthy' | 'expiring' | 'expired' | 'unknown' | 'unavailable' {
  if (credential?.expiresAt) {
    const expiry = Date.parse(credential.expiresAt);
    if (Number.isFinite(expiry)) {
      if (expiry <= now) return 'expired';
      if (!available) return 'unavailable';
      return expiry <= now + 7 * 24 * 60 * 60 * 1000 ? 'expiring' : 'healthy';
    }
  }
  if (!available) return 'unavailable';
  return credential?.expiresAt === null ? 'healthy' : 'unknown';
}
