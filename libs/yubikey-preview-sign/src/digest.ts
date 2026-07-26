import { sha256 } from './bytes.js';

/**
 * Produces the exact 32-byte digest accepted by previewSign `tbs`.
 *
 * This intentionally matches Yubico's preview examples: SHA-256 of the
 * caller-provided payload bytes, with no application envelope or domain prefix.
 */
export function createPreviewSignPrehash(payload: Uint8Array): Uint8Array {
  return sha256(payload);
}

/**
 * @deprecated Use `createPreviewSignPrehash`. The signed bytes intentionally
 * carry no application wire-version marker; protocol envelopes belong to
 * callers.
 */
export const createPreviewSignDigestV1 = createPreviewSignPrehash;
