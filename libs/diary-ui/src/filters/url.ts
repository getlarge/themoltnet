import {
  DEFAULT_WEIGHTS,
  type DiaryFilterState,
  type DiaryFilterWeights,
  EMPTY_FILTER_STATE,
  ENTRY_TYPES,
  type EntryType,
} from '../types.js';

function parseList(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseTypes(value: string | null): EntryType[] {
  return parseList(value).filter((item): item is EntryType =>
    (ENTRY_TYPES as readonly string[]).includes(item),
  );
}

function parseNumber(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseDiaryFiltersFromQuery(search: string): DiaryFilterState {
  const params = new URLSearchParams(
    search.startsWith('?') ? search.slice(1) : search,
  );

  const q = params.get('q') ?? '';
  const tagsRaw = params.get('tags');
  const tags = tagsRaw ? parseList(tagsRaw) : parseList(params.get('tag'));
  const excludeTags = parseList(params.get('excludeTags'));
  const typesRaw = params.get('types');
  const types = typesRaw
    ? parseTypes(typesRaw)
    : parseTypes(params.get('type'));
  const view = params.get('view') === 'timeline' ? 'timeline' : 'grid';

  let weights: DiaryFilterWeights | null = null;
  if (q !== '') {
    const relevance = parseNumber(params.get('wRelevance'));
    const recency = parseNumber(params.get('wRecency'));
    const importance = parseNumber(params.get('wImportance'));
    if (relevance !== null || recency !== null || importance !== null) {
      weights = {
        relevance: relevance ?? DEFAULT_WEIGHTS.relevance,
        recency: recency ?? DEFAULT_WEIGHTS.recency,
        importance: importance ?? DEFAULT_WEIGHTS.importance,
      };
    }
  }

  return { q, tags, excludeTags, types, view, weights };
}

function weightsEqualDefaults(weights: DiaryFilterWeights): boolean {
  return (
    weights.relevance === DEFAULT_WEIGHTS.relevance &&
    weights.recency === DEFAULT_WEIGHTS.recency &&
    weights.importance === DEFAULT_WEIGHTS.importance
  );
}

export function serializeDiaryFiltersToQuery(state: DiaryFilterState): string {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.tags.length > 0) params.set('tags', state.tags.join(','));
  if (state.excludeTags.length > 0)
    params.set('excludeTags', state.excludeTags.join(','));
  if (state.types.length > 0) params.set('types', state.types.join(','));
  if (state.view !== EMPTY_FILTER_STATE.view) params.set('view', state.view);
  if (state.q && state.weights && !weightsEqualDefaults(state.weights)) {
    params.set('wRelevance', String(state.weights.relevance));
    params.set('wRecency', String(state.weights.recency));
    params.set('wImportance', String(state.weights.importance));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}
