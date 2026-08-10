/**
 * Pack decay arithmetic.
 *
 * Storage invariant (see `contextPackRepository` / `renderedPackRepository`):
 * pinning **clears** `expiresAt` (`.set({ pinned: true, expiresAt: null })`),
 * and unpinning **requires** a new one (`unpin(id, expiresAt: Date)`). The
 * REST layer enforces the same: `PATCH /packs/:id` rejects `pinned: false`
 * without `expiresAt`, and rejects `expiresAt` on an already-pinned pack.
 *
 * `describeDecay` still checks `pinned` before touching `expiresAt`. That is
 * defensive, not a claim that both can be set: a client can hold a row
 * fetched before a pin landed, and reading a countdown off that stale row
 * would show an expiry for a pack that no longer has one.
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

/**
 * The `expiresAt` to send when unpinning.
 *
 * `PATCH /packs/:id` and `PATCH /rendered-packs/:id` both reject
 * `pinned: false` without an `expiresAt`, because the repository's
 * `unpin(id, expiresAt)` has nowhere to fall back to. Restoring the standard
 * decay window matches the column's own `now() + interval '7 days'` default,
 * so an unpinned pack re-enters the GC queue exactly where a fresh one would.
 */
export function defaultUnpinExpiry(now: Date): string {
  return new Date(
    now.getTime() + EXPIRING_SOON_DAYS * 86_400_000,
  ).toISOString();
}
