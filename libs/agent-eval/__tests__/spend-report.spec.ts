import { describe, expect, it } from 'vitest';

import {
  collectEvalSpend,
  type EvalSpendTask,
  formatEvalSpendReport,
} from '../src/spend-report.js';

function attempt(usd: number, complete = true) {
  return {
    claimedAt: '2026-10-01T00:00:00Z',
    startedAt: '2026-10-01T00:00:01Z',
    completedAt: '2026-10-01T00:00:02Z',
    usage: {
      inputTokens: 100,
      outputTokens: 10,
      cost: {
        currency: 'USD' as const,
        input: usd,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: usd,
        complete,
      },
    },
  };
}

const producer = (taskId: string, model = 'producer'): EvalSpendTask => ({
  taskId,
  model,
  provider: 'ollama-cloud',
  scenario: 'scenario',
  role: 'producer',
});

describe('eval spend reporting', () => {
  it('counts all attempts and fresh scenario retries, charging judge overhead to its producer', async () => {
    // A failed producer retry, a new successful task, and a judge attempt all
    // contribute, even when the judge failed to produce a usable score.
    const tasks: EvalSpendTask[] = [
      {
        ...producer('failed'),
        evaluation: { gatesPassed: false, judgedScore: 0 },
      },
      {
        ...producer('accepted'),
        evaluation: { gatesPassed: true, judgedScore: 0.8 },
      },
      {
        ...producer('judge', 'judge-model'),
        role: 'judge',
        producerTaskId: 'accepted',
      },
      producer('other', 'other-model'),
    ];
    const rows = {
      failed: [attempt(0.1), attempt(0.2)],
      accepted: [attempt(0.3)],
      judge: [attempt(0.4)],
      other: [attempt(0.5)],
    };
    const report = await collectEvalSpend(
      {
        suite: 'matrix',
        event: 'schedule',
        schedule: '0 3 * * 0',
        runAttempt: '2',
      },
      tasks,
      async (id) => rows[id as keyof typeof rows],
    );

    expect(report.schemaVersion).toBe(1);
    expect(report.context.runAttempt).toBe('2');
    expect(report.totals.producer.usage.estimatedCostUsd).toBeCloseTo(1.1);
    expect(report.totals.judge.usage.estimatedCostUsd).toBeCloseTo(0.4);
    expect(report.totals.combined.usage.estimatedCostUsd).toBeCloseTo(1.5);
    expect(report.totals.combined.usage.attempts).toBe(5);
    expect(report.models.map((r) => r.model)).toEqual([
      'producer',
      'other-model',
    ]);
    expect(report.models[0].combined.usage.estimatedCostUsd).toBeCloseTo(1);
    expect(report.models[0]).toMatchObject({
      scenarios: 1,
      gatesPassed: 1,
      meanJudgedScore: 0.8,
    });
    expect(report.records.find((r) => r.role === 'judge')?.model).toBe(
      'judge-model',
    );
    expect(formatEvalSpendReport(report)).toContain('$1.5000');
  });

  it('reports missing and unpriced telemetry without treating it as zero cost', async () => {
    const report = await collectEvalSpend(
      { suite: 'smoke' },
      ['priced', 'partial', 'unpriced', 'empty', 'unavailable'].map((id) =>
        producer(id),
      ),
      async (id) => {
        if (id === 'unavailable') throw new Error('private transport detail');
        if (id === 'empty') return [];
        if (id === 'unpriced')
          return [
            { ...attempt(0), usage: { inputTokens: 1, outputTokens: 0 } },
          ];
        return [attempt(0.1, id !== 'partial')];
      },
    );

    expect(report.totals.combined).toMatchObject({
      tasks: 5,
      fullyPricedTasks: 1,
      partiallyPricedTasks: 1,
      unpricedTasks: 1,
      missingTasks: 2,
    });
    expect(report.totals.combined.usage.costComplete).toBe(false);
    expect(formatEvalSpendReport(report)).toContain('≥$0.2000');
    expect(JSON.stringify(report)).not.toContain('private transport detail');
    expect(report.records.at(-1)?.error).toBe('attempts_unavailable');
  });

  it('updates repeated task registration without double counting and marks a missing-only total unknown', async () => {
    const report = await collectEvalSpend(
      { suite: 'smoke' },
      [producer('same'), producer('same')],
      async () => [],
    );
    expect(report.records).toHaveLength(1);
    expect(report.totals.combined.missingTasks).toBe(1);
    expect(formatEvalSpendReport(report)).toContain('unknown');
    expect(formatEvalSpendReport(report)).not.toContain('≥$0.0000');
  });

  it('escapes model and suite text in the GitHub summary', async () => {
    const report = await collectEvalSpend(
      { suite: '<b>suite</b>\nheading' },
      [producer('p', '<img>|[link](url)\nrow')],
      async () => [attempt(0)],
    );
    const markdown = formatEvalSpendReport(report);
    expect(markdown).not.toContain('<img>');
    expect(markdown).toContain('&lt;img&gt;\\|\\[link\\](url) row');
    expect(markdown).toContain('&lt;b&gt;suite&lt;/b&gt; heading');
    expect(report.totals.combined.fullyPricedTasks).toBe(1);
  });
});
