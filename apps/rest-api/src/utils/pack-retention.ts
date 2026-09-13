import type { PackGcConfig } from '../config.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Fallback when the app was built without a pack GC config (tests, tooling). */
const DEFAULT_COMPILE_TTL_DAYS = 7;

/**
 * The retention deadline the server applies to an unpinned pack.
 *
 * One arithmetic for both places that need it: pack creation (`from` is the
 * pack's `createdAt`) and a bare unpin (`from` is the request time). The window
 * is the deployment's `PACK_GC_COMPILE_TTL_DAYS`, so clients never have to
 * learn or mirror it — see #1858.
 */
export function compileTtlExpiry(
  packGcConfig: Pick<PackGcConfig, 'PACK_GC_COMPILE_TTL_DAYS'> | undefined,
  from: Date,
): Date {
  const ttlDays =
    packGcConfig?.PACK_GC_COMPILE_TTL_DAYS ?? DEFAULT_COMPILE_TTL_DAYS;
  return new Date(from.getTime() + ttlDays * MS_PER_DAY);
}
