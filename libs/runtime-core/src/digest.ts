import { createHash } from 'node:crypto';

const textEncoder = new TextEncoder();

function compareUtf8Bytes(a: string, b: string): number {
  const left = textEncoder.encode(a);
  const right = textEncoder.encode(b);
  const len = Math.min(left.length, right.length);
  for (let i = 0; i < len; i += 1) {
    const delta = left[i] - right[i];
    if (delta !== 0) return delta;
  }
  return left.length - right.length;
}

/**
 * Canonical JSON with the same rules as MoltNet's crypto-service
 * canonicalizer: object keys sorted by UTF-8 byte order, `undefined` members
 * dropped, arrays kept in order. The cross-language vectors in
 * `test-fixtures/executor-attestation-v1.json` apply.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) {
        throw new Error('Canonical JSON does not support non-finite numbers');
      }
      return JSON.stringify(value);
    case 'object':
      if (Array.isArray(value)) {
        return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(',')}]`;
      }
      return `{${Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => compareUtf8Bytes(a, b))
        .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
        .join(',')}}`;
    default:
      throw new Error(`Canonical JSON does not support ${typeof value}`);
  }
}

/** `sha256:<hex>` over canonical JSON. Same prefix the allowed-tools response uses. */
export function sha256Digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

export const SHA256_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

/** Structured clone plus recursive freeze; functions are kept by reference. */
export function deepFreezeClone<T>(value: T): T {
  if (Array.isArray(value)) {
    return Object.freeze(
      (value as unknown[]).map((v) => deepFreezeClone(v)),
    ) as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[k] = deepFreezeClone(v);
    }
    return Object.freeze(out) as T;
  }
  return value;
}
