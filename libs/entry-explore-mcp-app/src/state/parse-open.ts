/**
 * Tolerant parser turning the agent's opener output / tool-input push into a
 * {@link DiaryMapInit}. The agent is a language model — it may omit fields or
 * shape them loosely — so every field is defensively coerced and a missing
 * `zones` array yields an empty map (the UI then shows its agentless fallback).
 */
import type { DiaryMapInit, Zone, ZoneSearch } from './map.js';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function strArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string')
    : [];
}

function parseSearch(value: unknown): ZoneSearch {
  // Canonical snake_case fields only (EntryMapZoneSearchSchema). The app's
  // internal ZoneSearch is camelCase, so this is the one place that maps
  // exclude_tags -> excludeTags and entry_types -> types.
  const r = asRecord(value);
  const weights = asRecord(r.weights);
  return {
    query: typeof r.query === 'string' ? r.query : undefined,
    tags: strArray(r.tags),
    excludeTags: strArray(r.exclude_tags),
    types: strArray(r.entry_types),
    weights:
      Object.keys(weights).length > 0
        ? {
            relevance:
              typeof weights.relevance === 'number'
                ? weights.relevance
                : undefined,
            recency:
              typeof weights.recency === 'number' ? weights.recency : undefined,
            importance:
              typeof weights.importance === 'number'
                ? weights.importance
                : undefined,
          }
        : undefined,
  };
}

function parseZone(value: unknown, index: number): Zone {
  const r = asRecord(value);
  // Read the canonical contract fields only (EntryMapZoneSchema). The server
  // validates the agent's input against that schema before it reaches here, so
  // there is exactly one accepted field name per concept — no aliases. The
  // coercions below are just null-safety, not name-guessing.
  const entryIds = strArray(r.entry_ids);
  const why = str(r.why);
  const territory = typeof r.territory === 'string' ? r.territory : null;
  const provenance = asRecord(r.provenance);
  const searches = Array.isArray(provenance.searches)
    ? provenance.searches.map(parseSearch)
    : [];
  return {
    id: str(r.id, `zone-${index + 1}`),
    label: str(r.label, `Zone ${index + 1}`),
    why,
    territory,
    entryIds,
    provenance: {
      searches,
      basis: str(provenance.basis, why),
    },
    packId: typeof r.packId === 'string' ? r.packId : null,
    pinned: r.pinned === true,
    freshestEntryId:
      typeof r.freshestEntryId === 'string'
        ? r.freshestEntryId
        : (entryIds[0] ?? null),
  };
}

/**
 * Coerce an arbitrary agent payload into a {@link DiaryMapInit}, or return null
 * if it carries no usable diary id (in which case the app stays in its
 * "waiting for the agent" state rather than rendering a broken map).
 */
export function parseOpenPayload(raw: unknown): DiaryMapInit | null {
  const outer = asRecord(raw);
  // `diaryId` vs `diary_id` are NOT name-guessing: they are two distinct,
  // schema-defined wire shapes — the tool OUTPUT (EntryMapOpenOutputSchema,
  // flattened, `diaryId`) vs the tool INPUT (`diary_id` + nested `map`). Both
  // are legitimate envelopes the host delivers; the agent controls neither.
  const diaryId = str(outer.diaryId ?? outer.diary_id);
  if (!diaryId) return null;

  // The map may arrive flattened onto the payload (opener tool OUTPUT) or
  // nested under `map` (opener tool INPUT, delivered to ontoolinput). Merge the
  // nested form onto the top level so both paths render zones identically.
  const nested = asRecord(outer.map);
  const r: Record<string, unknown> = { ...nested, ...outer };
  if (outer.zones === undefined && nested.zones !== undefined) {
    r.zones = nested.zones;
  }

  const zones = Array.isArray(r.zones) ? r.zones.map(parseZone) : [];
  const sampledFromZones = zones.reduce(
    (sum, zone) => sum + zone.entryIds.length,
    0,
  );

  return {
    diaryId,
    diaryName: typeof r.diaryName === 'string' ? r.diaryName : null,
    totalEntries: num(r.totalEntries, sampledFromZones),
    sampledEntries: num(r.sampledEntries, sampledFromZones),
    overview: str(r.overview),
    zones,
  };
}
