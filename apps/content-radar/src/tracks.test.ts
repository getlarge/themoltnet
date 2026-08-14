import { describe, expect, it } from 'vitest';

import { parseTrackPlan, selectTracksForDrafting } from './tracks.js';
import type { SignalLedger, TrackCandidate, TrackPlan } from './types.js';

const LEDGER: SignalLedger = {
  work: [
    {
      id: 'work:themoltnet:01',
      repoSlug: 'themoltnet',
      kind: 'pull_request',
      title: 'Server-gated joins',
      reference: 'PR #1498',
      summary: 'A downstream task becomes claimable only after N complete.',
      evidence: 'join.ts diff',
    },
    {
      id: 'work:themoltnet:02',
      repoSlug: 'themoltnet',
      kind: 'diary_entry',
      title: 'Why claims, not assignments',
      reference: '5ad3b698',
      summary: 'Promise-theory framing for the runtime.',
      evidence: 'signed diary entry',
    },
  ],
  market: [
    {
      id: 'market:agent-runtimes:01',
      segmentSlug: 'agent-runtimes',
      organisation: 'Anthropic',
      title: 'Remote agent sessions',
      url: 'https://example.com/a',
      summary: 'Agents move off the laptop.',
    },
  ],
};

const TRACK = {
  id: 'promises-not-commands',
  title: 'Promises, not commands',
  thesis: 'You cannot assign work to an autonomous agent.',
  format: 'article',
  workSignalIds: ['work:themoltnet:01'],
  marketSignalIds: ['market:agent-runtimes:01'],
  rationale: 'The market just shipped what the join primitive assumed.',
  confidence: 'high',
};

function plan(tracks: unknown[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ version: 1, tracks, ...extra });
}

describe('parseTrackPlan — correlation contract', () => {
  it('accepts a track citing both streams', () => {
    const parsed = parseTrackPlan(plan([TRACK]), LEDGER);
    expect(parsed.tracks).toHaveLength(1);
    expect(parsed.tracks[0].id).toBe('promises-not-commands');
  });

  it('rejects a track with no market signal — that is a changelog', () => {
    expect(() =>
      parseTrackPlan(plan([{ ...TRACK, marketSignalIds: [] }]), LEDGER),
    ).toThrow('must cite at least one market signal');
  });

  it('rejects a track with no work signal — that is somebody else’s news', () => {
    expect(() =>
      parseTrackPlan(plan([{ ...TRACK, workSignalIds: [] }]), LEDGER),
    ).toThrow('must cite at least one work signal');
  });

  it('rejects a citation the ledger never issued', () => {
    expect(() =>
      parseTrackPlan(
        plan([{ ...TRACK, workSignalIds: ['work:themoltnet:99'] }]),
        LEDGER,
      ),
    ).toThrow('cites unknown work signal work:themoltnet:99');
  });

  it('rejects a work id used where a market id belongs', () => {
    expect(() =>
      parseTrackPlan(
        plan([{ ...TRACK, marketSignalIds: ['work:themoltnet:01'] }]),
        LEDGER,
      ),
    ).toThrow('cites unknown market signal work:themoltnet:01');
  });

  it('rejects two tracks citing exactly the same sources', () => {
    expect(() =>
      parseTrackPlan(
        plan([TRACK, { ...TRACK, id: 'same-piece-twice' }]),
        LEDGER,
      ),
    ).toThrow('cites the same signals as promises-not-commands');
  });

  it('rejects duplicate track ids', () => {
    expect(() =>
      parseTrackPlan(
        plan([TRACK, { ...TRACK, workSignalIds: ['work:themoltnet:02'] }]),
        LEDGER,
      ),
    ).toThrow('duplicate promises-not-commands');
  });

  it('rejects an unknown format', () => {
    expect(() =>
      parseTrackPlan(plan([{ ...TRACK, format: 'newsletter' }]), LEDGER),
    ).toThrow('format must be one of');
  });

  it('keeps the discarded record when present', () => {
    const parsed = parseTrackPlan(
      plan([TRACK], {
        discarded: [{ title: 'Too thin', reason: 'One weak source only.' }],
      }),
      LEDGER,
    );
    expect(parsed.discarded).toEqual([
      { title: 'Too thin', reason: 'One weak source only.' },
    ]);
  });
});

describe('selectTracksForDrafting', () => {
  function candidate(
    id: string,
    confidence: TrackCandidate['confidence'],
    workIds: string[],
  ): TrackCandidate {
    return {
      id,
      title: id,
      thesis: 'thesis',
      format: 'article',
      workSignalIds: workIds,
      marketSignalIds: ['market:agent-runtimes:01'],
      rationale: 'rationale',
      confidence,
    };
  }

  it('spends a tight budget on the best-evidenced tracks', () => {
    // Arrange
    const trackPlan: TrackPlan = {
      version: 1,
      tracks: [
        candidate('low-one', 'low', ['work:themoltnet:01']),
        candidate('high-thin', 'high', ['work:themoltnet:01']),
        candidate('high-broad', 'high', [
          'work:themoltnet:01',
          'work:themoltnet:02',
        ]),
      ],
    };

    // Act
    const selected = selectTracksForDrafting(trackPlan, 2);

    // Assert
    expect(selected.map((track) => track.id)).toEqual([
      'high-broad',
      'high-thin',
    ]);
  });

  it('clamps the budget to the trusted maximum', () => {
    const trackPlan: TrackPlan = {
      version: 1,
      tracks: Array.from({ length: 6 }, (_, index) =>
        candidate(`track-${index}`, 'high', ['work:themoltnet:01']),
      ),
    };
    expect(selectTracksForDrafting(trackPlan, 99)).toHaveLength(4);
  });
});
