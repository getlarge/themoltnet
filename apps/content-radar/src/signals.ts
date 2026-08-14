import {
  assertExactKeys,
  boundedArray,
  optionalTimestamp,
  parseStrictJsonObject,
  requiredNonEmptyString,
  strictRecord,
} from './strict-json.js';
import {
  type MarketSignal,
  MAX_MARKET_SIGNALS_PER_SEGMENT,
  MAX_WORK_SIGNALS_PER_REPO,
  type RepoTarget,
  type SignalLedger,
  type WatchSegment,
  WORK_SIGNAL_KINDS,
  type WorkSignal,
  type WorkSignalKind,
} from './types.js';

const WORK_SIGNAL_FIELDS = [
  'kind',
  'title',
  'reference',
  'summary',
  'evidence',
  'occurredAt',
] as const;

const MARKET_SIGNAL_FIELDS = [
  'organisation',
  'title',
  'url',
  'summary',
  'publishedAt',
] as const;

/**
 * Signal ids are issued by trusted code from the phase's own scope plus the
 * signal's ordinal. The model never supplies an id, so a later phase citing
 * `work:themoltnet:03` is citing something this run actually observed.
 */
function signalId(prefix: string, scope: string, index: number): string {
  return `${prefix}:${scope}:${String(index + 1).padStart(2, '0')}`;
}

function parseWorkSignalKind(value: unknown, label: string): WorkSignalKind {
  if (
    typeof value !== 'string' ||
    !(WORK_SIGNAL_KINDS as readonly string[]).includes(value)
  ) {
    throw new Error(
      `${label}.kind must be one of ${WORK_SIGNAL_KINDS.join(', ')}`,
    );
  }
  return value as WorkSignalKind;
}

/**
 * Parse a work-scan agent's strict-JSON summary into stamped work signals.
 *
 * `evidence` is mandatory and separate from `summary`: the summary is the
 * agent's prose, the evidence is what it actually read. A scan that cannot
 * point at a diff, an entry, or a release body has not found a signal.
 */
export function parseWorkSignals(
  source: string,
  repo: RepoTarget,
): WorkSignal[] {
  const label = `work scan (${repo.slug})`;
  const record = parseStrictJsonObject(source, label);
  assertExactKeys(record, ['version', 'repo', 'signals'], label);
  if (record.version !== 1) {
    throw new Error(`${label}.version must be 1`);
  }
  if (record.repo !== repo.slug) {
    throw new Error(
      `${label}.repo must be ${repo.slug}, got ${String(record.repo)}`,
    );
  }
  const items = boundedArray(
    record.signals,
    `${label}.signals`,
    MAX_WORK_SIGNALS_PER_REPO,
  );
  return items.map((item, index) => {
    const itemLabel = `${label}.signals[${index}]`;
    const signal = strictRecord(item, itemLabel);
    assertExactKeys(signal, WORK_SIGNAL_FIELDS, itemLabel);
    const occurredAt = optionalTimestamp(signal, 'occurredAt', itemLabel);
    return {
      id: signalId('work', repo.slug, index),
      repoSlug: repo.slug,
      kind: parseWorkSignalKind(signal.kind, itemLabel),
      title: requiredNonEmptyString(signal, 'title', itemLabel, 200),
      reference: requiredNonEmptyString(signal, 'reference', itemLabel, 300),
      summary: requiredNonEmptyString(signal, 'summary', itemLabel, 1200),
      evidence: requiredNonEmptyString(signal, 'evidence', itemLabel, 1200),
      ...(occurredAt ? { occurredAt } : {}),
    } satisfies WorkSignal;
  });
}

function assertSegmentUrl(
  url: string,
  segment: WatchSegment,
  label: string,
): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${label}.url must be an absolute URL`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`${label}.url must use https`);
  }
  if (!segment.organisations.length) {
    throw new Error(`segment ${segment.slug} has no organisations`);
  }
  return parsed.toString();
}

/**
 * Parse a market-sweep agent's strict-JSON summary into stamped market signals.
 *
 * The organisation must be one the operator listed for this segment. A sweep
 * that surfaces an interesting announcement from an unlisted company is
 * rejected: widening the watchlist is an operator decision, not a model one.
 */
export function parseMarketSignals(
  source: string,
  segment: WatchSegment,
): MarketSignal[] {
  const label = `market sweep (${segment.slug})`;
  const record = parseStrictJsonObject(source, label);
  assertExactKeys(record, ['version', 'segment', 'signals'], label);
  if (record.version !== 1) {
    throw new Error(`${label}.version must be 1`);
  }
  if (record.segment !== segment.slug) {
    throw new Error(
      `${label}.segment must be ${segment.slug}, got ${String(record.segment)}`,
    );
  }
  const allowed = new Set(
    segment.organisations.map((name) => name.toLowerCase()),
  );
  const items = boundedArray(
    record.signals,
    `${label}.signals`,
    MAX_MARKET_SIGNALS_PER_SEGMENT,
  );
  return items.map((item, index) => {
    const itemLabel = `${label}.signals[${index}]`;
    const signal = strictRecord(item, itemLabel);
    assertExactKeys(signal, MARKET_SIGNAL_FIELDS, itemLabel);
    const organisation = requiredNonEmptyString(
      signal,
      'organisation',
      itemLabel,
      120,
    );
    if (!allowed.has(organisation.toLowerCase())) {
      throw new Error(
        `${itemLabel}.organisation ${organisation} is not in segment ${segment.slug}`,
      );
    }
    const publishedAt = optionalTimestamp(signal, 'publishedAt', itemLabel);
    return {
      id: signalId('market', segment.slug, index),
      segmentSlug: segment.slug,
      organisation,
      title: requiredNonEmptyString(signal, 'title', itemLabel, 200),
      url: assertSegmentUrl(
        requiredNonEmptyString(signal, 'url', itemLabel, 500),
        segment,
        itemLabel,
      ),
      summary: requiredNonEmptyString(signal, 'summary', itemLabel, 1200),
      ...(publishedAt ? { publishedAt } : {}),
    } satisfies MarketSignal;
  });
}

/** Index the ledger by id for downstream citation checks. */
export function ledgerIndex(ledger: SignalLedger): Map<string, string> {
  const index = new Map<string, string>();
  for (const signal of ledger.work) index.set(signal.id, 'work');
  for (const signal of ledger.market) index.set(signal.id, 'market');
  return index;
}

/**
 * Compact ledger view handed to the correlation agent. Evidence strings stay
 * out: correlation reasons over titles and summaries, and the full evidence is
 * re-attached per track at draft time so each draft carries only its sources.
 */
export function correlationLedgerView(ledger: SignalLedger): string {
  const work = ledger.work
    .map(
      (signal) =>
        `- ${signal.id} [${signal.kind}] ${signal.title} (${signal.reference})\n  ${signal.summary}`,
    )
    .join('\n');
  const market = ledger.market
    .map(
      (signal) =>
        `- ${signal.id} [${signal.organisation}] ${signal.title} (${signal.url})\n  ${signal.summary}`,
    )
    .join('\n');
  return `WORK SIGNALS (what the operator shipped)\n${work || '- none'}\n\nMARKET SIGNALS (what the watched market announced)\n${market || '- none'}`;
}

/** Per-track source packet: only the signals that track is allowed to cite. */
export function trackSourceView(
  ledger: SignalLedger,
  workIds: string[],
  marketIds: string[],
): string {
  const workById = new Map(ledger.work.map((signal) => [signal.id, signal]));
  const marketById = new Map(
    ledger.market.map((signal) => [signal.id, signal]),
  );
  const work = workIds
    .map((id) => {
      const signal = workById.get(id);
      if (!signal) throw new Error(`unknown work signal ${id}`);
      return `- ${signal.id} [${signal.kind}] ${signal.title}\n  reference: ${signal.reference}\n  summary: ${signal.summary}\n  evidence: ${signal.evidence}`;
    })
    .join('\n');
  const market = marketIds
    .map((id) => {
      const signal = marketById.get(id);
      if (!signal) throw new Error(`unknown market signal ${id}`);
      return `- ${signal.id} [${signal.organisation}] ${signal.title}\n  url: ${signal.url}\n  summary: ${signal.summary}`;
    })
    .join('\n');
  return `CITABLE WORK SIGNALS\n${work || '- none'}\n\nCITABLE MARKET SIGNALS\n${market || '- none'}`;
}
