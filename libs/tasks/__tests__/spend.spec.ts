import { describe, expect, it } from 'vitest';

import {
  collectWorkflowSpend,
  formatWorkflowSpend,
  mergeWorkflowSpend,
  type SpendAttempt,
} from '../src/spend.js';

const cost = (total: number) => ({
  currency: 'USD' as const,
  input: total,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  total,
  complete: true,
});
function attempt(usage: SpendAttempt['usage']): SpendAttempt {
  return {
    usage,
    claimedAt: '2026-01-01T00:00:00Z',
    startedAt: null,
    completedAt: '2026-01-01T00:01:00Z',
  };
}

describe('workflow spend', () => {
  it('counts every attempt, deduplicates task IDs and separates actual models and tools without doubling totals', async () => {
    const report = await collectWorkflowSpend(
      [
        { taskId: 'a', stage: 'hunt' },
        { taskId: 'a', stage: 'hunt' },
      ],
      async () => [
        attempt({
          inputTokens: 12,
          outputTokens: 3,
          cost: cost(3),
          models: [
            {
              provider: 'p',
              model: 'one',
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              inputTokens: 10,
              outputTokens: 2,
              cost: cost(2),
            },
          ],
          tools: [
            {
              tool: 'summarizer',
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              inputTokens: 2,
              outputTokens: 1,
              cost: cost(1),
            },
          ],
        }),
        attempt({
          provider: 'p',
          model: 'two',
          inputTokens: 5,
          outputTokens: 1,
          cost: cost(1),
        }),
      ],
    );
    expect(report.records).toHaveLength(1);
    expect(report.records[0].spend).toMatchObject({
      attempts: 2,
      inputTokens: 17,
      outputTokens: 4,
      estimatedCostUsd: 4,
      costComplete: true,
    });
    const markdown = formatWorkflowSpend(mergeWorkflowSpend([report, report]));
    expect(markdown).toContain('p/one');
    expect(markdown).toContain('p/two');
    expect(markdown).toContain('tool:summarizer');
    expect(markdown).toContain(
      '| **Total** | | 1 | 2 | 17 | 4 | 0 / 0 | 2m 0s | $4.0000 |',
    );
  });

  it('keeps missing, empty and unfinished attempts unknown and retains known lower bounds', async () => {
    const report = await collectWorkflowSpend(
      ['missing', 'empty', 'partial', 'unfinished'].map((taskId) => ({
        taskId,
        stage: taskId,
      })),
      async (id) => {
        if (id === 'missing') throw new Error('private transport details');
        if (id === 'empty') return [];
        if (id === 'unfinished')
          return [{ ...attempt(null), completedAt: null }];
        return [
          attempt({ inputTokens: 10, outputTokens: 1, cost: cost(1) }),
          attempt(null),
        ];
      },
    );
    const markdown = formatWorkflowSpend(report);
    expect(markdown).toContain('≥$1.0000');
    expect(markdown).toContain('unknown');
    expect(markdown).toContain('0/4 fully priced');
    expect(markdown).not.toContain('private transport details');
    expect(JSON.stringify(report)).not.toContain('private transport details');
  });

  it('does not price zero counters without a pricing verdict as a free task', async () => {
    const report = await collectWorkflowSpend(
      [{ taskId: 'a', stage: 'failed task' }],
      async () => [attempt({ inputTokens: 0, outputTokens: 0 })],
    );
    expect(report.records[0].spend.costComplete).toBe(false);
    expect(formatWorkflowSpend(report)).toContain('unknown');
  });

  it('escapes model metadata and never retains attempt outputs', async () => {
    const report = await collectWorkflowSpend(
      [{ taskId: 'a', stage: 'a|b\n@team' }],
      async () => [
        {
          ...attempt({
            model: '<script>[x](url)',
            inputTokens: 1,
            outputTokens: 1,
          }),
          output: { private: 'evidence' },
        },
      ],
    );
    const markdown = formatWorkflowSpend(report);
    expect(markdown).toContain('&lt;script&gt;');
    expect(markdown).not.toContain('@team');
    expect(JSON.stringify(report)).not.toContain('evidence');
  });
});
