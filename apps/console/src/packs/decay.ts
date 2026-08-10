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

/**
 * Days assumed for the server's retention window when the console has to
 * compute a deadline itself.
 *
 * KNOWN DIVERGENCE: the server's real window is `PACK_GC_COMPILE_TTL_DAYS`
 * (`apps/rest-api/src/config.ts`), which is operator-configurable and only
 * *defaults* to 7. The console cannot read it — no endpoint exposes it — so on
 * a deployment configured for, say, 30 days an unpin here shortens retention
 * to 7. The real fix is server-side: `PATCH /packs/:id` should accept a bare
 * `{ pinned: false }` and assign the deadline from its own config and clock.
 * Tracked in #1858; until then this constant is the closest honest guess.
 */
export const ASSUMED_SERVER_TTL_DAYS = 7;

/**
 * The `expiresAt` to send when unpinning.
 *
 * `PATCH /packs/:id` and `PATCH /rendered-packs/:id` both reject
 * `pinned: false` without an `expiresAt`, because the repository's
 * `unpin(id, expiresAt)` has nowhere to fall back to. Callers that know the
 * intended retention should pass it explicitly rather than rely on the
 * assumed default above.
 */
export function defaultUnpinExpiry(now: Date): string {
  return new Date(
    now.getTime() + ASSUMED_SERVER_TTL_DAYS * 86_400_000,
  ).toISOString();
}
