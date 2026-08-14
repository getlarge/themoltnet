import { ledgerIndex } from './signals.js';
import {
  assertExactKeys,
  boundedArray,
  nonEmptyStringArray,
  parseStrictJsonObject,
  requiredNonEmptyString,
  strictRecord,
} from './strict-json.js';
import {
  MAX_DRAFT_TASKS,
  MAX_SIGNALS_PER_TRACK,
  MAX_TRACKS,
  type SignalLedger,
  TRACK_FORMATS,
  type TrackCandidate,
  type TrackFormat,
  type TrackPlan,
} from './types.js';

const TRACK_FIELDS = [
  'id',
  'title',
  'thesis',
  'format',
  'workSignalIds',
  'marketSignalIds',
  'rationale',
  'confidence',
] as const;

const CONFIDENCE_VALUES = ['high', 'medium', 'low'] as const;
const TRACK_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function parseFormat(value: unknown, label: string): TrackFormat {
  if (
    typeof value !== 'string' ||
    !(TRACK_FORMATS as readonly string[]).includes(value)
  ) {
    throw new Error(
      `${label}.format must be one of ${TRACK_FORMATS.join(', ')}`,
    );
  }
  return value as TrackFormat;
}

function parseConfidence(
  value: unknown,
  label: string,
): TrackCandidate['confidence'] {
  if (
    typeof value !== 'string' ||
    !(CONFIDENCE_VALUES as readonly string[]).includes(value)
  ) {
    throw new Error(
      `${label}.confidence must be one of ${CONFIDENCE_VALUES.join(', ')}`,
    );
  }
  return value as TrackCandidate['confidence'];
}

function assertUnique(values: string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw new Error(`${label} contains duplicate ${value}`);
    }
    seen.add(value);
  }
}

/**
 * Parse and validate a correlation agent's track plan against the ledger.
 *
 * The load-bearing rule is the correlation contract: **every track must cite at
 * least one work signal and at least one market signal**. A track citing only
 * work signals is a changelog; a track citing only market signals is somebody
 * else's news. Neither is a piece the operator is uniquely placed to write, so
 * trusted code rejects both rather than leaving it to prompt discipline.
 */
export function parseTrackPlan(
  source: string,
  ledger: SignalLedger,
): TrackPlan {
  const label = 'track plan';
  const record = parseStrictJsonObject(source, label);
  assertExactKeys(record, ['version', 'tracks', 'discarded'], label);
  if (record.version !== 1) {
    throw new Error(`${label}.version must be 1`);
  }
  const index = ledgerIndex(ledger);
  const items = boundedArray(record.tracks, `${label}.tracks`, MAX_TRACKS);
  const tracks = items.map((item, position) => {
    const itemLabel = `${label}.tracks[${position}]`;
    const track = strictRecord(item, itemLabel);
    assertExactKeys(track, TRACK_FIELDS, itemLabel);
    const id = requiredNonEmptyString(track, 'id', itemLabel, 60);
    if (!TRACK_ID_PATTERN.test(id)) {
      throw new Error(`${itemLabel}.id must be a kebab-case slug`);
    }
    const workSignalIds = nonEmptyStringArray(
      track.workSignalIds,
      `${itemLabel}.workSignalIds`,
      MAX_SIGNALS_PER_TRACK,
    );
    const marketSignalIds = nonEmptyStringArray(
      track.marketSignalIds,
      `${itemLabel}.marketSignalIds`,
      MAX_SIGNALS_PER_TRACK,
    );
    if (workSignalIds.length === 0) {
      throw new Error(
        `${itemLabel} must cite at least one work signal; a track with no work signal is not the operator's story to tell`,
      );
    }
    if (marketSignalIds.length === 0) {
      throw new Error(
        `${itemLabel} must cite at least one market signal; a track with no market signal is a changelog, not a correlation`,
      );
    }
    assertUnique(workSignalIds, `${itemLabel}.workSignalIds`);
    assertUnique(marketSignalIds, `${itemLabel}.marketSignalIds`);
    for (const signalId of workSignalIds) {
      if (index.get(signalId) !== 'work') {
        throw new Error(`${itemLabel} cites unknown work signal ${signalId}`);
      }
    }
    for (const signalId of marketSignalIds) {
      if (index.get(signalId) !== 'market') {
        throw new Error(`${itemLabel} cites unknown market signal ${signalId}`);
      }
    }
    return {
      id,
      title: requiredNonEmptyString(track, 'title', itemLabel, 200),
      thesis: requiredNonEmptyString(track, 'thesis', itemLabel, 1000),
      format: parseFormat(track.format, itemLabel),
      workSignalIds,
      marketSignalIds,
      rationale: requiredNonEmptyString(track, 'rationale', itemLabel, 1500),
      confidence: parseConfidence(track.confidence, itemLabel),
    } satisfies TrackCandidate;
  });
  assertUnique(
    tracks.map((track) => track.id),
    `${label}.tracks`,
  );
  assertDistinctCitations(tracks);

  const discarded = record.discarded;
  if (discarded !== undefined) {
    const entries = boundedArray(discarded, `${label}.discarded`, MAX_TRACKS);
    return {
      version: 1,
      tracks,
      discarded: entries.map((entry, position) => {
        const entryLabel = `${label}.discarded[${position}]`;
        const value = strictRecord(entry, entryLabel);
        assertExactKeys(value, ['title', 'reason'], entryLabel);
        return {
          title: requiredNonEmptyString(value, 'title', entryLabel, 200),
          reason: requiredNonEmptyString(value, 'reason', entryLabel, 500),
        };
      }),
    };
  }
  return { version: 1, tracks };
}

/**
 * Two tracks citing exactly the same sources are the same piece wearing two
 * titles. Fanning out drafts for both spends a runtime slot to produce a near
 * duplicate, so the plan is rejected instead.
 */
function assertDistinctCitations(tracks: TrackCandidate[]): void {
  const seen = new Map<string, string>();
  for (const track of tracks) {
    const fingerprint = [
      [...track.workSignalIds].sort().join(','),
      [...track.marketSignalIds].sort().join(','),
    ].join('|');
    const previous = seen.get(fingerprint);
    if (previous) {
      throw new Error(
        `track ${track.id} cites the same signals as ${previous}; merge them or differentiate the sources`,
      );
    }
    seen.set(fingerprint, track.id);
  }
}

/**
 * Choose which planned tracks get drafted. Ordering is by confidence and then
 * by breadth of correlation, so a run under a tight draft budget spends it on
 * the tracks with the most evidence behind them rather than on plan order.
 */
export function selectTracksForDrafting(
  plan: TrackPlan,
  maxDrafts: number,
): TrackCandidate[] {
  const budget = Math.max(1, Math.min(maxDrafts, MAX_DRAFT_TASKS));
  const rank = { high: 0, medium: 1, low: 2 } as const;
  return [...plan.tracks]
    .sort((left, right) => {
      const byConfidence = rank[left.confidence] - rank[right.confidence];
      if (byConfidence !== 0) return byConfidence;
      const leftBreadth =
        left.workSignalIds.length + left.marketSignalIds.length;
      const rightBreadth =
        right.workSignalIds.length + right.marketSignalIds.length;
      if (leftBreadth !== rightBreadth) return rightBreadth - leftBreadth;
      return left.id.localeCompare(right.id);
    })
    .slice(0, budget);
}
