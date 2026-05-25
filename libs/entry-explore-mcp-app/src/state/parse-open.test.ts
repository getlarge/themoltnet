import { describe, expect, it } from 'vitest';

import { parseOpenPayload } from './parse-open.js';

describe('parseOpenPayload', () => {
  it('returns null without a diary id', () => {
    expect(parseOpenPayload({})).toBeNull();
    expect(parseOpenPayload({ zones: [] })).toBeNull();
    expect(parseOpenPayload(undefined)).toBeNull();
  });

  it('reads the diary id from either wire shape (output `diaryId` / input `diary_id`)', () => {
    expect(parseOpenPayload({ diaryId: 'd1' })?.diaryId).toBe('d1');
    expect(parseOpenPayload({ diary_id: 'd2' })?.diaryId).toBe('d2');
  });

  it('parses a full canonical zone (entry_ids, why, territory, provenance)', () => {
    const init = parseOpenPayload({
      diaryId: 'd1',
      diaryName: 'themoltnet',
      totalEntries: 2000,
      sampledEntries: 96,
      overview: 'Three zones.',
      zones: [
        {
          id: 'z1',
          label: 'Infra',
          why: 'deployment + docker',
          territory: 'scope:infra',
          entry_ids: ['e1', 'e2'],
          provenance: {
            basis: 'tag:scope:infra',
            searches: [
              {
                query: 'docker',
                tags: ['scope:infra'],
                entry_types: ['semantic'],
              },
            ],
          },
        },
      ],
    });

    expect(init).not.toBeNull();
    expect(init!.zones[0]).toMatchObject({
      id: 'z1',
      label: 'Infra',
      why: 'deployment + docker',
      territory: 'scope:infra',
      entryIds: ['e1', 'e2'],
      freshestEntryId: 'e1',
    });
    expect(init!.zones[0].provenance.searches[0]).toMatchObject({
      query: 'docker',
      tags: ['scope:infra'],
      types: ['semantic'], // entry_types -> types (the one canonical mapping)
    });
  });

  // The empty-zones bug was the agent sending non-canonical names (anchorEntries
  // /summary) that the app silently accepted-then-dropped. The fix is a typed
  // schema, so the parser now reads ONLY canonical fields; non-canonical names
  // are ignored here (and rejected upstream by EntryMapZoneSchema validation).
  it('ignores non-canonical zone field names (no alias guessing)', () => {
    const init = parseOpenPayload({
      diary_id: 'd1',
      zones: [
        {
          id: 'z1',
          label: 'Infra',
          summary: 'should be ignored',
          anchorEntries: ['e1', 'e2'],
        },
      ],
    });
    expect(init!.zones[0].entryIds).toEqual([]);
    expect(init!.zones[0].why).toBe('');
  });

  it('synthesizes ids/labels and infers sample size from zones when absent', () => {
    const init = parseOpenPayload({
      diary_id: 'd1',
      zones: [{ entry_ids: ['e1', 'e2'] }, { entry_ids: ['e3'] }],
    });

    expect(init!.zones[0].id).toBe('zone-1');
    expect(init!.zones[0].label).toBe('Zone 1');
    // total/sampled fall back to the summed zone membership.
    expect(init!.totalEntries).toBe(3);
    expect(init!.sampledEntries).toBe(3);
  });

  it('merges a nested `map` object (opener tool INPUT shape)', () => {
    const init = parseOpenPayload({
      diary_id: 'd1',
      map: {
        diaryName: 'themoltnet',
        totalEntries: 2000,
        overview: 'Nested overview.',
        zones: [{ id: 'z1', label: 'Infra', entry_ids: ['e1'] }],
      },
    });

    expect(init).not.toBeNull();
    expect(init!.diaryName).toBe('themoltnet');
    expect(init!.totalEntries).toBe(2000);
    expect(init!.overview).toBe('Nested overview.');
    expect(init!.zones).toHaveLength(1);
    expect(init!.zones[0].label).toBe('Infra');
  });

  it('prefers flattened top-level fields over a nested map', () => {
    const init = parseOpenPayload({
      diary_id: 'd1',
      overview: 'flat',
      zones: [{ id: 'flat', entry_ids: ['e1'] }],
      map: { overview: 'nested', zones: [{ id: 'nested', entry_ids: ['e2'] }] },
    });
    expect(init!.overview).toBe('flat');
    expect(init!.zones[0].id).toBe('flat');
  });
});
