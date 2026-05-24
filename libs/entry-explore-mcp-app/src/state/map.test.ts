import { beforeEach, describe, expect, it } from 'vitest';

import {
  activeTrailStep,
  DIARY_MAP_VERSION,
  type DiaryMap,
  type DiaryMapInit,
  findZone,
  initMap,
  mapReducer,
  resetStepIds,
  type Zone,
} from './map.js';

function zone(id: string, entryIds: string[], over: Partial<Zone> = {}): Zone {
  return {
    id,
    label: `Zone ${id}`,
    why: `because ${id}`,
    territory: null,
    entryIds,
    provenance: { searches: [], basis: 'test' },
    packId: null,
    pinned: false,
    freshestEntryId: entryIds[0] ?? null,
    ...over,
  };
}

function init(over: Partial<DiaryMapInit> = {}): DiaryMapInit {
  return {
    diaryId: 'diary-1',
    diaryName: 'themoltnet',
    totalEntries: 2000,
    sampledEntries: 96,
    overview: 'Three zones stand out.',
    zones: [zone('a', ['e1', 'e2']), zone('b', ['e3', 'e4', 'e5'])],
    ...over,
  };
}

describe('initMap', () => {
  beforeEach(() => resetStepIds());

  it('seeds version, a single "All" root step spanning every zone entry', () => {
    const map = initMap(init());

    expect(map.version).toBe(DIARY_MAP_VERSION);
    expect(map.trail).toHaveLength(1);
    expect(map.activeStep).toBe(0);
    expect(map.activeZoneId).toBeNull();
    expect(map.trail[0].label).toBe('All');
    expect(map.trail[0].visibleEntryIds).toEqual([
      'e1',
      'e2',
      'e3',
      'e4',
      'e5',
    ]);
    expect(map.trail[0].why).toContain('96');
    expect(map.trail[0].why).toContain('2000');
  });
});

describe('mapReducer', () => {
  let map: DiaryMap;

  beforeEach(() => {
    resetStepIds();
    map = initMap(init());
  });

  it('INIT replaces state from null', () => {
    const next = mapReducer(null, { type: 'INIT', payload: init() });
    expect(next?.diaryId).toBe('diary-1');
  });

  it('FOCUS_ZONE sets activeZoneId without pushing a trail step', () => {
    const next = mapReducer(map, { type: 'FOCUS_ZONE', zoneId: 'b' });
    expect(next?.activeZoneId).toBe('b');
    expect(next?.trail).toHaveLength(1);
  });

  it('FOCUS_ZONE on an unknown zone is a no-op', () => {
    const next = mapReducer(map, { type: 'FOCUS_ZONE', zoneId: 'zzz' });
    expect(next).toBe(map);
  });

  it('SHOW_OVERVIEW clears the active zone', () => {
    const focused = mapReducer(map, { type: 'FOCUS_ZONE', zoneId: 'a' })!;
    const next = mapReducer(focused, { type: 'SHOW_OVERVIEW' });
    expect(next?.activeZoneId).toBeNull();
  });

  it('REFINE_SEARCH pushes a step and advances activeStep', () => {
    const next = mapReducer(map, {
      type: 'REFINE_SEARCH',
      label: 'autonomy',
      why: 'narrowed to autonomy',
      query: 'autonomy',
      visibleEntryIds: ['e3', 'e4'],
    })!;

    expect(next.trail).toHaveLength(2);
    expect(next.activeStep).toBe(1);
    expect(activeTrailStep(next).visibleEntryIds).toEqual(['e3', 'e4']);
    expect(activeTrailStep(next).why).toBe('narrowed to autonomy');
  });

  it('RESTORE_STEP moves back with ZERO refetch, truncates the future, and clears the active zone', () => {
    let next = mapReducer(map, {
      type: 'REFINE_SEARCH',
      label: 'autonomy',
      why: 'w1',
      query: 'autonomy',
      visibleEntryIds: ['e3', 'e4'],
    })!;
    next = mapReducer(next, {
      type: 'REFINE_SEARCH',
      label: 'identity',
      why: 'w2',
      query: 'identity',
      visibleEntryIds: ['e3'],
    })!;
    // Focus a zone so we can assert RESTORE_STEP clears it on its own.
    next = mapReducer(next, { type: 'FOCUS_ZONE', zoneId: 'a' })!;
    expect(next.trail).toHaveLength(3);
    expect(next.activeZoneId).toBe('a');

    const restored = mapReducer(next, { type: 'RESTORE_STEP', index: 0 })!;
    // The cached visible set is reused verbatim — no new ids, no fetch needed.
    expect(restored.activeStep).toBe(0);
    expect(restored.trail).toHaveLength(1);
    // Returning to a past step returns to its overview — zone cleared.
    expect(restored.activeZoneId).toBeNull();
    expect(activeTrailStep(restored).visibleEntryIds).toEqual([
      'e1',
      'e2',
      'e3',
      'e4',
      'e5',
    ]);
  });

  it('REFINE_SEARCH from a restored past step discards the abandoned future', () => {
    let next = mapReducer(map, {
      type: 'REFINE_SEARCH',
      label: 'autonomy',
      why: 'w1',
      query: 'autonomy',
      visibleEntryIds: ['e3', 'e4'],
    })!;
    next = mapReducer(next, {
      type: 'REFINE_SEARCH',
      label: 'identity',
      why: 'w2',
      query: 'identity',
      visibleEntryIds: ['e3'],
    })!;
    const back = mapReducer(next, { type: 'RESTORE_STEP', index: 1 })!;

    const branched = mapReducer(back, {
      type: 'REFINE_SEARCH',
      label: 'infra',
      why: 'w3',
      query: 'infra',
      visibleEntryIds: ['e1'],
    })!;

    expect(branched.trail.map((step) => step.label)).toEqual([
      'All',
      'autonomy',
      'infra',
    ]);
    expect(branched.activeStep).toBe(2);
  });

  it('RESTORE_STEP out of range is a no-op', () => {
    expect(mapReducer(map, { type: 'RESTORE_STEP', index: 9 })).toBe(map);
    expect(mapReducer(map, { type: 'RESTORE_STEP', index: -1 })).toBe(map);
  });

  it('MATERIALIZE_ZONE records the draft pack id on the zone only', () => {
    const next = mapReducer(map, {
      type: 'MATERIALIZE_ZONE',
      zoneId: 'a',
      packId: 'pack-1',
    })!;
    expect(findZone(next, 'a')?.packId).toBe('pack-1');
    expect(findZone(next, 'b')?.packId).toBeNull();
  });

  it('PIN_ZONE flips the pinned flag (validation)', () => {
    const next = mapReducer(map, {
      type: 'PIN_ZONE',
      zoneId: 'b',
      pinned: true,
    })!;
    expect(findZone(next, 'b')?.pinned).toBe(true);
    expect(findZone(next, 'a')?.pinned).toBe(false);
  });
});
