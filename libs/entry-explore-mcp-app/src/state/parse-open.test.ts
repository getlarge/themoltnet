import { describe, expect, it } from 'vitest';

import { parseOpenPayload } from './parse-open.js';

describe('parseOpenPayload', () => {
  it('returns null without a diary id', () => {
    expect(parseOpenPayload({})).toBeNull();
    expect(parseOpenPayload({ zones: [] })).toBeNull();
    expect(parseOpenPayload(undefined)).toBeNull();
  });

  it('accepts both camelCase and snake_case diary id', () => {
    expect(parseOpenPayload({ diaryId: 'd1' })?.diaryId).toBe('d1');
    expect(parseOpenPayload({ diary_id: 'd2' })?.diaryId).toBe('d2');
  });

  it('parses a full agent payload', () => {
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
          entryIds: ['e1', 'e2'],
          provenance: {
            basis: 'tag:scope:infra',
            searches: [{ query: 'docker', tags: ['scope:infra'] }],
          },
        },
      ],
    });

    expect(init).not.toBeNull();
    expect(init!.zones[0]).toMatchObject({
      id: 'z1',
      label: 'Infra',
      territory: 'scope:infra',
      entryIds: ['e1', 'e2'],
      freshestEntryId: 'e1',
    });
    expect(init!.zones[0].provenance.searches[0]).toMatchObject({
      query: 'docker',
      tags: ['scope:infra'],
    });
  });

  it('reads the canonical snake_case `entry_ids` field', () => {
    const init = parseOpenPayload({
      diary_id: 'd1',
      zones: [{ id: 'z1', label: 'Infra', entry_ids: ['e1', 'e2'] }],
    });
    expect(init!.zones[0].entryIds).toEqual(['e1', 'e2']);
  });

  // Regression for the reported bug: a real agent sent `anchorEntries` /
  // `summary` / `tags` (not `entryIds` / `why` / `territory`), and every zone
  // rendered with 0 entries because the parser only read the latter names.
  it('tolerates the agent aliases anchorEntries/summary/tags', () => {
    const init = parseOpenPayload({
      diary_id: 'd1',
      zones: [
        {
          id: 'zone-teams-mgmt',
          label: 'Thread A — Team management surface',
          summary: 'Team management surface threads.',
          anchorEntries: ['18599892-aaaa', 'a6d41eed-bbbb', '43e32f81-cccc'],
          tags: ['scope:teams', 'scope:principals'],
        },
      ],
    });

    const zone = init!.zones[0];
    expect(zone.entryIds).toEqual([
      '18599892-aaaa',
      'a6d41eed-bbbb',
      '43e32f81-cccc',
    ]);
    expect(zone.why).toBe('Team management surface threads.');
    // `territory` falls back to the first tag when not explicitly set.
    expect(zone.territory).toBe('scope:teams');
    expect(zone.freshestEntryId).toBe('18599892-aaaa');
  });

  it('synthesizes ids/labels and infers sample size from zones when absent', () => {
    const init = parseOpenPayload({
      diary_id: 'd1',
      zones: [{ entryIds: ['e1', 'e2'] }, { entryIds: ['e3'] }],
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
        zones: [{ id: 'z1', label: 'Infra', entryIds: ['e1'] }],
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
      zones: [{ id: 'flat', entryIds: ['e1'] }],
      map: { overview: 'nested', zones: [{ id: 'nested', entryIds: ['e2'] }] },
    });
    expect(init!.overview).toBe('flat');
    expect(init!.zones[0].id).toBe('flat');
  });

  it('tolerates snake_case zone fields', () => {
    const init = parseOpenPayload({
      diary_id: 'd1',
      zones: [{ entry_ids: ['e9'], why: 'x' }],
    });
    expect(init!.zones[0].entryIds).toEqual(['e9']);
  });
});
