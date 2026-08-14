/**
 * Strict parsing helpers for untrusted model output.
 *
 * NOTE: `apps/multi-lens-review/src/strict-json.ts` carries the same helpers.
 * Both apps validate agent-authored JSON the same way, so this is a deliberate
 * near-duplicate pending extraction into `@themoltnet/tasks-orchestrator`
 * (tracked as a follow-up). It is copied rather than shared today because
 * hoisting it would mean editing a security-critical app for a cosmetic gain.
 */

export function parseStrictJsonObject(
  source: string,
  label: string,
): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error(`${label} must be strict JSON`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

export function strictRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function assertExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length > 0) {
    throw new Error(`${label} contains unknown fields: ${extras.join(', ')}`);
  }
}

export function requiredNonEmptyString(
  value: Record<string, unknown>,
  key: string,
  label: string,
  maxLength = 2000,
): string {
  const field = value[key];
  if (typeof field !== 'string' || !field.trim()) {
    throw new Error(`${label}.${key} must be a non-empty string`);
  }
  const trimmed = field.trim();
  if (trimmed.length > maxLength) {
    throw new Error(`${label}.${key} must be at most ${maxLength} characters`);
  }
  return trimmed;
}

export function optionalString(
  value: Record<string, unknown>,
  key: string,
  label: string,
  maxLength = 2000,
): string | undefined {
  if (value[key] === undefined || value[key] === null) return undefined;
  return requiredNonEmptyString(value, key, label, maxLength);
}

export function boundedArray(
  value: unknown,
  label: string,
  maxItems: number,
): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  if (value.length > maxItems) {
    throw new Error(`${label} must contain at most ${maxItems} entries`);
  }
  return value;
}

export function nonEmptyStringArray(
  value: unknown,
  label: string,
  maxItems: number,
): string[] {
  const items = boundedArray(value, label, maxItems);
  return items.map((item, index) => {
    if (typeof item !== 'string' || !item.trim()) {
      throw new Error(`${label}[${index}] must be a non-empty string`);
    }
    return item.trim();
  });
}

/** An ISO-8601 instant, rejected rather than coerced when malformed. */
export function optionalTimestamp(
  value: Record<string, unknown>,
  key: string,
  label: string,
): string | undefined {
  const raw = optionalString(value, key, label, 40);
  if (raw === undefined) return undefined;
  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) {
    throw new Error(`${label}.${key} must be an ISO-8601 timestamp`);
  }
  return new Date(parsed).toISOString();
}
