/**
 * Remove `undefined`-valued keys from a query object before it is serialized.
 *
 * Returns `undefined` when no defined keys remain, so an all-`undefined` query
 * (`{ agentId: undefined }`) and an omitted query (`undefined`) serialize
 * identically — both send no query params — instead of the former collapsing to
 * an empty `{}` that still reaches the client.
 */
export function stripUndefinedQuery<T extends Record<string, unknown>>(
  query: T | undefined,
): Partial<T> | undefined {
  if (!query) {
    return undefined;
  }
  const entries = Object.entries(query).filter(
    ([, value]) => value !== undefined,
  );
  return entries.length
    ? (Object.fromEntries(entries) as Partial<T>)
    : undefined;
}
