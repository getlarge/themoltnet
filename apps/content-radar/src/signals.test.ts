import { describe, expect, it } from 'vitest';

import { parseMarketSignals, parseWorkSignals } from './signals.js';
import type { RepoTarget, WatchSegment } from './types.js';

const REPO: RepoTarget = {
  slug: 'themoltnet',
  repository: 'getlarge/themoltnet',
  sinceDays: 30,
};

const SEGMENT: WatchSegment = {
  slug: 'agent-runtimes',
  title: 'Agent runtimes',
  organisations: ['Anthropic', 'OpenAI'],
  queries: ['headless agents'],
  sinceDays: 21,
};

const WORK_SIGNAL = {
  kind: 'pull_request',
  title: 'Server-gated joins over MoltNet tasks',
  reference: 'PR #1498',
  summary:
    'Downstream continuations became claimable only after N tasks completed.',
  evidence: 'Read the diff in libs/tasks-orchestrator/src/join.ts.',
};

const MARKET_SIGNAL = {
  organisation: 'Anthropic',
  title: 'Something was announced',
  url: 'https://example.com/post',
  summary: 'They shipped a thing that overlaps with the join primitive.',
};

function workOutput(signals: unknown[]): string {
  return JSON.stringify({ version: 1, repo: REPO.slug, signals });
}

function marketOutput(signals: unknown[]): string {
  return JSON.stringify({ version: 1, segment: SEGMENT.slug, signals });
}

describe('parseWorkSignals', () => {
  it('stamps trusted ids the model never supplied', () => {
    // Arrange / Act
    const signals = parseWorkSignals(
      workOutput([WORK_SIGNAL, { ...WORK_SIGNAL, kind: 'diary_entry' }]),
      REPO,
    );

    // Assert
    expect(signals.map((signal) => signal.id)).toEqual([
      'work:themoltnet:01',
      'work:themoltnet:02',
    ]);
    expect(signals[0].repoSlug).toBe('themoltnet');
  });

  it('rejects an id the model tried to supply itself', () => {
    expect(() =>
      parseWorkSignals(workOutput([{ ...WORK_SIGNAL, id: 'work:x:99' }]), REPO),
    ).toThrow('contains unknown fields: id');
  });

  it('rejects a signal with no evidence', () => {
    expect(() =>
      parseWorkSignals(workOutput([{ ...WORK_SIGNAL, evidence: '  ' }]), REPO),
    ).toThrow('evidence must be a non-empty string');
  });

  it('rejects an unknown signal kind', () => {
    expect(() =>
      parseWorkSignals(workOutput([{ ...WORK_SIGNAL, kind: 'tweet' }]), REPO),
    ).toThrow('kind must be one of');
  });

  it('rejects output claiming a different repository', () => {
    const source = JSON.stringify({
      version: 1,
      repo: 'somewhere-else',
      signals: [WORK_SIGNAL],
    });
    expect(() => parseWorkSignals(source, REPO)).toThrow(
      'must be themoltnet, got somewhere-else',
    );
  });

  it('rejects more signals than the phase budget allows', () => {
    const many = Array.from({ length: 13 }, () => WORK_SIGNAL);
    expect(() => parseWorkSignals(workOutput(many), REPO)).toThrow(
      'at most 12 entries',
    );
  });

  it('normalizes an optional timestamp and rejects a malformed one', () => {
    const [signal] = parseWorkSignals(
      workOutput([{ ...WORK_SIGNAL, occurredAt: '2026-07-01' }]),
      REPO,
    );
    expect(signal.occurredAt).toBe('2026-07-01T00:00:00.000Z');
    expect(() =>
      parseWorkSignals(
        workOutput([{ ...WORK_SIGNAL, occurredAt: 'last tuesday' }]),
        REPO,
      ),
    ).toThrow('must be an ISO-8601 timestamp');
  });
});

describe('parseMarketSignals', () => {
  it('stamps trusted ids scoped to the segment', () => {
    const signals = parseMarketSignals(marketOutput([MARKET_SIGNAL]), SEGMENT);
    expect(signals[0].id).toBe('market:agent-runtimes:01');
    expect(signals[0].segmentSlug).toBe('agent-runtimes');
  });

  it('rejects an organisation the operator never watch-listed', () => {
    expect(() =>
      parseMarketSignals(
        marketOutput([{ ...MARKET_SIGNAL, organisation: 'Meta' }]),
        SEGMENT,
      ),
    ).toThrow('Meta is not in segment agent-runtimes');
  });

  it('matches watch-listed organisations case-insensitively', () => {
    const signals = parseMarketSignals(
      marketOutput([{ ...MARKET_SIGNAL, organisation: 'anthropic' }]),
      SEGMENT,
    );
    expect(signals[0].organisation).toBe('anthropic');
  });

  it.each([
    ['not-a-url', 'must be an absolute URL'],
    ['http://example.com/post', 'must use https'],
  ])('rejects url %s', (url, message) => {
    expect(() =>
      parseMarketSignals(marketOutput([{ ...MARKET_SIGNAL, url }]), SEGMENT),
    ).toThrow(message);
  });
});
