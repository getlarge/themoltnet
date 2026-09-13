const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The GC deadline of an unpinned pack: `from` plus the retention window.
 *
 * The single implementation of pack retention arithmetic. Pack and rendered
 * pack creation pass their `createdAt`; a bare unpin passes the request time
 * so a long-pinned pack does not become collectable the moment it is released
 * (#1858). `ttlDays` is the deployment's `PACK_GC_COMPILE_TTL_DAYS`, validated
 * strictly positive at config load; the guard here is defence in depth for
 * callers that bypass that boundary.
 */
export function packExpiryFrom(from: Date, ttlDays: number): Date {
  if (!Number.isFinite(ttlDays) || ttlDays <= 0) {
    throw new RangeError(
      `Pack retention window must be a positive number of days, got ${String(ttlDays)}`,
    );
  }
  return new Date(from.getTime() + ttlDays * MS_PER_DAY);
}
