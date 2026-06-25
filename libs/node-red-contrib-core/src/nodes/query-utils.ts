export function csv(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const items = value.filter(
      (item): item is string => typeof item === 'string',
    );
    return items.length > 0 ? items : undefined;
  }
  if (typeof value !== 'string') return undefined;
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

export function bool(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

export function positiveInt(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export function nonNegativeInt(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

export function finiteNumber(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function compact(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  );
}

export function normalizeAliases(
  payload: Record<string, unknown>,
  aliases: Record<string, string>,
): Record<string, unknown> {
  const normalized = { ...payload };
  for (const [alias, canonical] of Object.entries(aliases)) {
    if (
      normalized[alias] !== undefined &&
      normalized[canonical] === undefined
    ) {
      normalized[canonical] = normalized[alias];
      delete normalized[alias];
    }
  }
  return normalized;
}
