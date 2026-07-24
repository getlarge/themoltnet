import { sha256 } from './bytes.js';

/**
 * Produces the exact 32-byte digest accepted by previewSign `tbs`.
 *
 * This intentionally matches Yubico's preview examples: SHA-256 of the
 * caller-provided payload bytes, with no MoltNet envelope or domain prefix.
 */
export function createPreviewSignDigestV1(payload: Uint8Array): Uint8Array {
  return sha256(payload);
}
