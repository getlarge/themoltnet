/**
 * Transient, client-held exploration state for the diary map app.
 *
 * The agent (client LLM) interprets a diary into {@link Zone}s and hands the app
 * a {@link DiaryMap}. The human then refines it via search/filter; each
 * refinement pushes a {@link TrailStep} onto a breadcrumb trail. Going *back* is
 * a zero-fetch operation because every step caches the exact `visibleEntryIds`
 * it rendered — only forward refinements call the server.
 *
 * Nothing here is persisted server-side. A zone is materialized into a durable
 * artifact only when {@link MapAction} `MATERIALIZE_ZONE`/`PIN_ZONE` turn it into
 * a (draft, then pinned) context pack via the MCP adapter.
 *
 * Artifact contract: `moltnet.diary-map/v1`.
 */
export const DIARY_MAP_VERSION = 'moltnet.diary-map/v1' as const;

/** A single recorded search that contributed entries to a zone. */
export interface ZoneSearch {
  query?: string;
  tags?: string[];
  excludeTags?: string[];
  types?: string[];
  weights?: { relevance?: number; recency?: number; importance?: number };
}

/**
 * Why a zone's entries belong together — becomes the pack `params` on
 * materialize, so a zone is reproducible from its provenance alone.
 */
export interface ZoneProvenance {
  searches: ZoneSearch[];
  /** Human-language summary of the selection basis, e.g. "tag:auth + recent". */
  basis: string;
}

/** An agent-interpreted grouping of entries. */
export interface Zone {
  id: string;
  /** Agent's human-language label, e.g. "Infra & deployment decisions". */
  label: string;
  /** One line: why these entries belong together. */
  why: string;
  /** Governing tag/namespace, if the zone maps onto one. */
  territory: string | null;
  entryIds: string[];
  provenance: ZoneProvenance;
  /** Set once the zone is materialized as a draft context pack. */
  packId: string | null;
  /** Mirrors the pack pin state once the human validates the zone. */
  pinned: boolean;
  /** Entry id considered freshest/most representative, for the overview card. */
  freshestEntryId: string | null;
}

/** One breadcrumb chip: a camera position in the exploration. */
export interface TrailStep {
  id: string;
  /** Chip label, e.g. "All", "reflective", or a search query. */
  label: string;
  /** Chip subtitle / hover — the "why this changed" explanation. */
  why: string;
  /** Exact set rendered at this step; enables zero-fetch back navigation. */
  visibleEntryIds: string[];
  /** Search query active at this step, if any. */
  query: string | null;
}

/** The full client-held exploration document. */
export interface DiaryMap {
  version: typeof DIARY_MAP_VERSION;
  diaryId: string;
  diaryName: string | null;
  /** Total entries in the diary (from `entries_list` total) — honest "of N". */
  totalEntries: number;
  /** How many entries the agent actually sampled to build this map. */
  sampledEntries: number;
  /** Agent's 1–3 sentence orientation, shown on first paint. */
  overview: string;
  zones: Zone[];
  /** Breadcrumb trail; `trail[0]` is always the "All" root. */
  trail: TrailStep[];
  /** Index into `trail` of the current camera position. */
  activeStep: number;
  /** Currently focused zone, or null when showing the overview. */
  activeZoneId: string | null;
}

/** Payload the agent sends to seed/replace the map (opener output or push). */
export interface DiaryMapInit {
  diaryId: string;
  diaryName?: string | null;
  totalEntries: number;
  sampledEntries: number;
  overview: string;
  zones: Zone[];
}

export type MapAction =
  | { type: 'INIT'; payload: DiaryMapInit }
  | { type: 'FOCUS_ZONE'; zoneId: string }
  | { type: 'SHOW_OVERVIEW' }
  | {
      type: 'REFINE_SEARCH';
      label: string;
      why: string;
      query: string | null;
      visibleEntryIds: string[];
    }
  | { type: 'RESTORE_STEP'; index: number }
  | { type: 'MATERIALIZE_ZONE'; zoneId: string; packId: string }
  | { type: 'PIN_ZONE'; zoneId: string; pinned: boolean };

let stepCounter = 0;

/** Resettable monotonic id source — keeps trail-step ids deterministic in tests. */
export function nextStepId(): string {
  stepCounter += 1;
  return `step-${stepCounter}`;
}

export function resetStepIds(): void {
  stepCounter = 0;
}

function rootStep(map: DiaryMapInit): TrailStep {
  return {
    id: nextStepId(),
    label: 'All',
    why: `Sampled ${map.sampledEntries} of ${map.totalEntries} entries.`,
    visibleEntryIds: map.zones.flatMap((zone) => zone.entryIds),
    query: null,
  };
}

export function initMap(payload: DiaryMapInit): DiaryMap {
  return {
    version: DIARY_MAP_VERSION,
    diaryId: payload.diaryId,
    diaryName: payload.diaryName ?? null,
    totalEntries: payload.totalEntries,
    sampledEntries: payload.sampledEntries,
    overview: payload.overview,
    zones: payload.zones,
    trail: [rootStep(payload)],
    activeStep: 0,
    activeZoneId: null,
  };
}

/**
 * Pure reducer over the exploration document.
 *
 * Invariants enforced here (the comprehension model depends on them):
 * - `RESTORE_STEP` never fetches; it only moves `activeStep` and truncates any
 *   forward trail, so going back is instant and the breadcrumb stays a true
 *   history.
 * - A forward `REFINE_SEARCH` truncates the trail at `activeStep` before pushing
 *   (standard breadcrumb semantics: refining from a past step discards the
 *   abandoned future).
 * - `FOCUS_ZONE` is a camera move, not a refine: it does not push a trail step,
 *   because the zone set is already part of the map the agent produced.
 */
export function mapReducer(
  state: DiaryMap | null,
  action: MapAction,
): DiaryMap | null {
  switch (action.type) {
    case 'INIT':
      return initMap(action.payload);
    default:
      break;
  }

  if (!state) return state;

  switch (action.type) {
    case 'FOCUS_ZONE': {
      if (!state.zones.some((zone) => zone.id === action.zoneId)) return state;
      return { ...state, activeZoneId: action.zoneId };
    }

    case 'SHOW_OVERVIEW':
      return { ...state, activeZoneId: null };

    case 'REFINE_SEARCH': {
      const kept = state.trail.slice(0, state.activeStep + 1);
      const step: TrailStep = {
        id: nextStepId(),
        label: action.label,
        why: action.why,
        visibleEntryIds: action.visibleEntryIds,
        query: action.query,
      };
      const trail = [...kept, step];
      return { ...state, trail, activeStep: trail.length - 1 };
    }

    case 'RESTORE_STEP': {
      if (action.index < 0 || action.index >= state.trail.length) return state;
      return {
        ...state,
        trail: state.trail.slice(0, action.index + 1),
        activeStep: action.index,
      };
    }

    case 'MATERIALIZE_ZONE': {
      const zones = state.zones.map((zone) =>
        zone.id === action.zoneId ? { ...zone, packId: action.packId } : zone,
      );
      return { ...state, zones };
    }

    case 'PIN_ZONE': {
      const zones = state.zones.map((zone) =>
        zone.id === action.zoneId ? { ...zone, pinned: action.pinned } : zone,
      );
      return { ...state, zones };
    }

    default:
      return state;
  }
}

/** The trail step currently in view. */
export function activeTrailStep(map: DiaryMap): TrailStep {
  return map.trail[map.activeStep];
}

/** Find a zone by id, or null. */
export function findZone(map: DiaryMap, zoneId: string | null): Zone | null {
  if (!zoneId) return null;
  return map.zones.find((zone) => zone.id === zoneId) ?? null;
}
