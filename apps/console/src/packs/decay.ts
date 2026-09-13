/**
 * Pack decay arithmetic.
 *
 * Storage invariant (see `contextPackRepository` / `renderedPackRepository`):
 * pinning **clears** `expiresAt` (`.set({ pinned: true, expiresAt: null })`),
 * and unpinning always writes a new one (`unpin(id, expiresAt: Date)`). The
 * REST layer assigns that deadline itself when a client sends a bare
 * `{ pinned: false }` (#1858), and rejects `expiresAt` on an already-pinned
 * pack.
 *
 * `describeDecay` still checks `pinned` before touching `expiresAt`. That is
 * defensive, not a claim that both can be set: a client can hold a row
 * fetched before a pin landed, and reading a countdown off that stale row
 * would show an expiry for a pack that no longer has one.
 *
 * `now` is injected so callers are deterministic under test; production
 * callers pass `new Date()`.
 */

/**
 * Threshold for the "expiring soon" badge, in days.
 *
 * A display heuristic only: the actual retention window is the server's
 * `PACK_GC_COMPILE_TTL_DAYS`, which the console never needs to know.
 */
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
  // Pinned wins defensively: storage clears expiresAt on pin, so a row that
  // carries both is a stale client copy fetched before the pin landed.
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
