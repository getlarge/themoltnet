import type { TaskUsage } from '@moltnet/tasks';
import { describe, expect, it } from 'vitest';

import {
  formatProducerSpend,
  mergeProducerSpend,
  summarizeProducerSpend,
} from '../src/producer-spend.js';

const cost = (total: number, complete = true) => ({
  currency: 'USD' as const,
  total,
  input: total,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  complete,
});

function attempt(usage: TaskUsage | null, seconds = 10) {
  return {
    usage,
    claimedAt: '2026-10-01T00:00:00.000Z',
    startedAt: '2026-10-01T00:00:01.000Z',
    completedAt: new Date(
      Date.UTC(2026, 9, 1, 0, 0, 1 + seconds),
    ).toISOString(),
  };
}

describe('summarizeProducerSpend', () => {
  it('charges every attempt, including failed retries', () => {
    // Arrange
    const attempts = [
      attempt({ inputTokens: 100, outputTokens: 10, cost: cost(0.01) }),
      attempt(
        {
          inputTokens: 200,
          outputTokens: 20,
          cacheReadTokens: 50,
          reasoningTokens: 5,
          cost: cost(0.02),
        },
        20,
      ),
    ];

    // Act
    const spend = summarizeProducerSpend(attempts);

    // Assert
    expect(spend).toMatchObject({
      attempts: 2,
      inputTokens: 300,
      outputTokens: 30,
      cacheReadTokens: 50,
      reasoningTokens: 5,
      costComplete: true,
      durationMs: 30_000,
    });
    expect(spend.estimatedCostUsd).toBeCloseTo(0.03);
  });

  it('marks cost incomplete when an attempt with tokens had no price', () => {
    // Arrange
    const attempts = [
      attempt({ inputTokens: 100, outputTokens: 10, cost: cost(0.01) }),
      attempt({ inputTokens: 100, outputTokens: 10 }),
      attempt(null),
    ];

    // Act
    const spend = summarizeProducerSpend(attempts);

    // Assert
    expect(spend.costComplete).toBe(false);
    expect(formatProducerSpend(spend)).toBe(
      'tokens=220 cost=≥$0.0100 attempts=3',
    );
  });

  it('ignores unfinished attempts when summing duration', () => {
    // Arrange
    const running = { ...attempt(null), completedAt: null };

    // Act
    const spend = summarizeProducerSpend([running]);

    // Assert
    expect(spend.durationMs).toBe(0);
  });
});

describe('mergeProducerSpend', () => {
  it('sums runs and keeps an unpriced run visible', () => {
    // Arrange
    const priced = summarizeProducerSpend([
      attempt({ inputTokens: 10, outputTokens: 1, cost: cost(0.5) }),
    ]);
    const unpriced = summarizeProducerSpend([
      attempt({ inputTokens: 10, outputTokens: 1 }),
    ]);

    // Act
    const total = mergeProducerSpend([priced, unpriced]);

    // Assert
    expect(total).toMatchObject({
      attempts: 2,
      inputTokens: 20,
      estimatedCostUsd: 0.5,
      costComplete: false,
    });
    expect(formatProducerSpend(unpriced)).toContain('cost=unpriced');
  });
});
