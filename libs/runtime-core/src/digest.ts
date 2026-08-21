import { createHash } from 'node:crypto';

/** Canonical JSON: sorted object keys, no undefined members, stable arrays. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const member = (value as Record<string, unknown>)[key];
      if (member !== undefined) out[key] = sortKeys(member);
    }
    return out;
  }
  return value;
}

/** `sha256:<hex>` over canonical JSON. Same prefix the allowed-tools response uses. */
export function sha256Digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

export const SHA256_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
