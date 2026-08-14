import { describe, expect, it } from 'vitest';

import { parseTrackDossier, unusedSignals } from './dossier.js';
import {
  DOSSIER_ARTIFACT_KIND,
  type TrackCandidate,
  WIREFRAME_ARTIFACT_KIND,
} from './types.js';

const TRACK: TrackCandidate = {
  id: 'promises-not-commands',
  title: 'Promises, not commands',
  thesis: 'You cannot assign work to an autonomous agent.',
  format: 'article',
  workSignalIds: ['work:themoltnet:01', 'work:themoltnet:02'],
  marketSignalIds: ['market:agent-runtimes:01'],
  rationale: 'rationale',
  confidence: 'high',
};

const ARTIFACTS = [
  {
    kind: DOSSIER_ARTIFACT_KIND,
    title: 'dossier.md',
    cid: 'bafy-dossier',
    contentType: 'text/markdown;charset=utf-8',
    sizeBytes: 4096,
  },
  {
    kind: WIREFRAME_ARTIFACT_KIND,
    title: 'wireframe.md',
    cid: 'bafy-wireframe',
    contentType: 'text/markdown;charset=utf-8',
    sizeBytes: 2048,
  },
];

function dossier(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 1,
    trackId: TRACK.id,
    slug: 'promises-not-commands',
    workingTitle: 'Promises, not commands',
    description: 'Why a task system for agents looks like this.',
    tags: ['ai-agents', 'orchestration'],
    claims: [
      {
        signalId: 'work:themoltnet:01',
        claim: 'The join is server-enforced, not orchestrator-enforced.',
      },
    ],
    openQuestions: ['Does the series framing still hold?'],
    ...overrides,
  });
}

describe('parseTrackDossier — citation containment', () => {
  it('accepts a dossier citing only its own assigned signals', () => {
    const parsed = parseTrackDossier(dossier(), TRACK, ARTIFACTS);
    expect(parsed.slug).toBe('promises-not-commands');
    expect(parsed.dossierArtifact.cid).toBe('bafy-dossier');
    expect(parsed.wireframeArtifact.cid).toBe('bafy-wireframe');
  });

  it('rejects a claim citing a signal assigned to another track', () => {
    const source = dossier({
      claims: [{ signalId: 'market:other-segment:01', claim: 'Borrowed.' }],
    });
    expect(() => parseTrackDossier(source, TRACK, ARTIFACTS)).toThrow(
      'is not a source assigned to track promises-not-commands',
    );
  });

  it('rejects a dossier that cites none of its assigned signals', () => {
    // Every claim cites a valid id, but the guard for "cited nothing" only
    // fires when the intersection is empty — which containment already blocks.
    const source = dossier({ claims: [] });
    expect(() => parseTrackDossier(source, TRACK, ARTIFACTS)).toThrow(
      'must contain at least one claim',
    );
  });

  it('rejects a mismatched trackId', () => {
    const source = dossier({ trackId: 'some-other-track' });
    expect(() => parseTrackDossier(source, TRACK, ARTIFACTS)).toThrow(
      'must be promises-not-commands, got some-other-track',
    );
  });

  it('rejects a non-kebab slug', () => {
    const source = dossier({ slug: 'Promises Not Commands' });
    expect(() => parseTrackDossier(source, TRACK, ARTIFACTS)).toThrow(
      'slug must be a kebab-case slug',
    );
  });
});

describe('parseTrackDossier — artifact presence', () => {
  it('rejects a missing wireframe artifact', () => {
    expect(() => parseTrackDossier(dossier(), TRACK, [ARTIFACTS[0]])).toThrow(
      `must report exactly one ${WIREFRAME_ARTIFACT_KIND} artifact`,
    );
  });

  it('rejects a duplicated dossier artifact', () => {
    expect(() =>
      parseTrackDossier(dossier(), TRACK, [...ARTIFACTS, ARTIFACTS[0]]),
    ).toThrow(`must report exactly one ${DOSSIER_ARTIFACT_KIND} artifact`);
  });

  it('rejects an artifact reported without an upload CID', () => {
    const artifacts = [{ ...ARTIFACTS[0], cid: undefined }, ARTIFACTS[1]];
    expect(() => parseTrackDossier(dossier(), TRACK, artifacts)).toThrow(
      'must carry the CID returned by moltnet_upload_task_artifact',
    );
  });

  it('rejects an artifact reporting zero bytes', () => {
    const artifacts = [{ ...ARTIFACTS[0], sizeBytes: 0 }, ARTIFACTS[1]];
    expect(() => parseTrackDossier(dossier(), TRACK, artifacts)).toThrow(
      'must report a positive sizeBytes',
    );
  });
});

describe('unusedSignals', () => {
  it('reports signals the plan assigned but the dossier never used', () => {
    const parsed = parseTrackDossier(dossier(), TRACK, ARTIFACTS);
    expect(unusedSignals(TRACK, parsed)).toEqual([
      'work:themoltnet:02',
      'market:agent-runtimes:01',
    ]);
  });
});
