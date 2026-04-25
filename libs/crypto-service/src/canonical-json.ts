/**
 * Canonical JSON for cross-language signing and CID inputs.
 *
 * This intentionally implements the subset MoltNet signs: JSON values with
 * finite numbers, strings, booleans, null, arrays, and objects. Object keys are
 * sorted by UTF-8 byte order and no insignificant whitespace is emitted.
 */

const textEncoder = new TextEncoder();

export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) {
        throw new Error('Canonical JSON does not support non-finite numbers');
      }
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'object':
      if (Array.isArray(value)) {
        return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
      }
      return canonicalObject(value as Record<string, unknown>);
    case 'undefined':
    case 'function':
    case 'symbol':
    case 'bigint':
      throw new Error(`Canonical JSON does not support ${typeof value}`);
    default:
      throw new Error('Canonical JSON does not support this value');
  }
}

function canonicalObject(value: Record<string, unknown>): string {
  const entries = Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => compareUtf8Bytes(a, b));

  return `{${entries
    .map(([key, v]) => `${JSON.stringify(key)}:${canonicalJson(v)}`)
    .join(',')}}`;
}

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

export function canonicalJsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalJson(value));
}
