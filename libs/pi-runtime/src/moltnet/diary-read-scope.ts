/** Profile-owned, non-secret source configuration. Never read from guest env. */
export const DIARY_READ_IDS_ENV = 'REVIEW_DIARY_IDS';

export function parseDiaryReadIds(
  raw: string | undefined,
): readonly string[] | undefined {
  if (raw === undefined) return undefined;
  const ids: unknown = JSON.parse(raw);
  if (
    !Array.isArray(ids) ||
    ids.length > 8 ||
    !ids.every(
      (id) =>
        typeof id === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          id,
        ),
    )
  )
    throw new Error(
      `${DIARY_READ_IDS_ENV} must be a JSON array of at most 8 diary UUIDs`,
    );
  return [...new Set(ids)];
}

/** Bounds live SDK lookups in one toolset; durable replay does not repeat them. */
export function createDiaryReadScope(diaryIds: readonly string[]) {
  let calls = 0;
  return {
    diaryIds,
    takeCall() {
      if (calls >= 8)
        throw new Error(
          'Diary lookup budget exhausted; report any remaining uncertainty',
        );
      calls += 1;
    },
    diary(requested?: string) {
      const id = requested ?? (diaryIds.length === 1 ? diaryIds[0] : undefined);
      if (!id || !diaryIds.includes(id))
        throw new Error('Choose a diary from the configured read sources');
      return id;
    },
  };
}
