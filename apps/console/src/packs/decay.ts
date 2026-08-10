/**
 * Pack decay arithmetic.
 *
 * `expiresAt` defaults to `now() + interval '7 days'` and is ignored while
 * `pinned` is true. Pinning does NOT clear the column, so a pinned pack can
 * still carry a future `expiresAt` — `pinned` must be checked first.
 *
 * `now` is injected so callers are deterministic under test; production
 * callers pass `new Date()`.
 */

/** Unpinned packs GC after 7 days; this is the "expiring soon" window. */
export const EXPIRING_SOON_DAYS = 7;

export type DecayState =
  | { kind: 'pinned' }
  | { kind: 'expiring'; daysRemaining: number }
  | { kind: 'expired' }
  | { kind: 'no-expiry' };

export interface DecayInput {
  pinned: boolean;
  expiresAt: string | null;
}

export function describeDecay(
  { pinned, expiresAt }: DecayInput,
  now: Date,
): DecayState {
  // Pinning does not clear expiresAt, so pinned must win.
  if (pinned) return { kind: 'pinned' };
  if (!expiresAt) return { kind: 'no-expiry' };

  const remainingMs = new Date(expiresAt).getTime() - now.getTime();
  if (remainingMs <= 0) return { kind: 'expired' };

  return {
    // Round up so a pack with hours left never reads "expires in 0 days".
    kind: 'expiring',
    daysRemaining: Math.ceil(remainingMs / 86_400_000),
  };
}

export function isExpiringSoon(state: DecayState): boolean {
  return state.kind === 'expiring' && state.daysRemaining <= EXPIRING_SOON_DAYS;
}
