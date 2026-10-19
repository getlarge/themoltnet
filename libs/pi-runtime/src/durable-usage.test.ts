import type { UsageState } from '@earendil-works/pi-durable';
import { describe, expect, it } from 'vitest';

import { taskUsageFromState, usageSince } from './durable-usage.js';

type Bucket = UsageState['models'][string];

function bucket(
  tokens: Partial<Omit<Bucket, 'cost'>>,
  cost: Partial<Bucket['cost']> = {},
): Bucket {
  const input = tokens.input ?? 0;
  const output = tokens.output ?? 0;
  const cacheRead = tokens.cacheRead ?? 0;
  const cacheWrite = tokens.cacheWrite ?? 0;
  return {
    ...tokens,
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens: input + output + cacheRead + cacheWrite,
    cost: {
      input: cost.input ?? 0,
      output: cost.output ?? 0,
      cacheRead: cost.cacheRead ?? 0,
      cacheWrite: cost.cacheWrite ?? 0,
      total: cost.total ?? 0,
    },
  };
}

const primary = { provider: 'anthropic', model: 'claude-opus' };

describe('taskUsageFromState', () => {
  it('keeps the per-model split and sums cost', () => {
    // Arrange
    const state: UsageState = {
      models: {
        'anthropic/claude-opus': bucket(
          { input: 100, output: 50, cacheRead: 10, reasoning: 20 },
          { input: 0.1, output: 0.2, cacheRead: 0.01, total: 0.31 },
        ),
        'openrouter/meta/llama-4': bucket(
          { input: 40, output: 10 },
          { input: 0.02, output: 0.03, total: 0.05 },
        ),
      },
      tools: {},
    };

    // Act
    const usage = taskUsageFromState(state, primary);

    // Assert
    expect(usage).toMatchObject({
      inputTokens: 140,
      outputTokens: 60,
      cacheReadTokens: 10,
      cacheWriteTokens: 0,
      reasoningTokens: 20,
      provider: 'anthropic',
      model: 'claude-opus',
      cost: { currency: 'USD', complete: true },
    });
    expect(usage.cost?.total).toBeCloseTo(0.36);
    expect(usage.models).toEqual([
      expect.objectContaining({
        provider: 'anthropic',
        model: 'claude-opus',
        reasoningTokens: 20,
      }),
      expect.objectContaining({
        provider: 'openrouter',
        model: 'meta/llama-4',
      }),
    ]);
  });

  it('marks cost incomplete instead of pricing an unpriced model at zero', () => {
    // Arrange
    const state: UsageState = {
      models: {
        'anthropic/claude-opus': bucket(
          { input: 100, output: 50 },
          { input: 0.1, output: 0.2, total: 0.3 },
        ),
        'ollama/qwen3': bucket({ input: 500, output: 200 }),
      },
      tools: {},
    };

    // Act
    const usage = taskUsageFromState(state, primary);

    // Assert
    expect(usage.cost).toMatchObject({ total: 0.3, complete: false });
    expect(
      usage.models?.find((m) => m.provider === 'ollama'),
    ).not.toHaveProperty('cost');
  });

  it('omits cost when nothing is priced', () => {
    // Arrange
    const state: UsageState = {
      models: { 'ollama/qwen3': bucket({ input: 5, output: 2 }) },
      tools: {},
    };

    // Act
    const usage = taskUsageFromState(state, primary);

    // Assert
    expect(usage).not.toHaveProperty('cost');
    expect(usage).not.toHaveProperty('reasoningTokens');
  });

  it('reports tool spend apart from model spend and includes it in totals', () => {
    // Arrange
    const state: UsageState = {
      models: { 'anthropic/claude-opus': bucket({ input: 10, output: 5 }) },
      tools: {
        summarize: bucket({ input: 30, output: 3 }, { total: 0.01 }),
        noop: bucket({}),
      },
    };

    // Act
    const usage = taskUsageFromState(state, primary);

    // Assert
    expect(usage.inputTokens).toBe(40);
    expect(usage.tools).toEqual([
      expect.objectContaining({ tool: 'summarize', inputTokens: 30 }),
    ]);
    expect(usage.tools?.[0].cost?.complete).toBe(false);
    expect(usage.cost?.complete).toBe(false);
  });

  it('keeps mixed-price tool spend incomplete after subtracting a continuation baseline', () => {
    const key = 'pi.codemode.models.classify';
    const baseline: UsageState = {
      models: {},
      tools: { [key]: bucket({ input: 100 }, { input: 0.01, total: 0.01 }) },
    };
    // The next attempt adds a priced 100-token call and an unpriced 200-token
    // call. Pi retains only their combined tool counters.
    const current: UsageState = {
      models: {},
      tools: { [key]: bucket({ input: 400 }, { input: 0.02, total: 0.02 }) },
    };

    const usage = taskUsageFromState(usageSince(current, baseline), primary);

    expect(usage.inputTokens).toBe(300);
    expect(usage.cost).toMatchObject({ total: 0.01, complete: false });
    expect(usage.tools?.[0].cost).toMatchObject({
      total: 0.01,
      complete: false,
    });
  });
});

describe('usageSince', () => {
  it('subtracts the baseline per bucket and keeps new buckets whole', () => {
    // Arrange
    const baseline: UsageState = {
      models: {
        'anthropic/claude-opus': bucket(
          { input: 100, output: 10, reasoning: 4 },
          { total: 1 },
        ),
      },
      tools: {},
    };
    const current: UsageState = {
      models: {
        'anthropic/claude-opus': bucket(
          { input: 150, output: 30, reasoning: 9 },
          { total: 1.5 },
        ),
        'openai/gpt-5': bucket({ input: 7 }),
      },
      tools: {},
    };

    // Act
    const delta = usageSince(current, baseline);

    // Assert
    expect(delta.models['anthropic/claude-opus']).toMatchObject({
      input: 50,
      output: 20,
      reasoning: 5,
      cost: { total: 0.5 },
    });
    expect(delta.models['openai/gpt-5']?.input).toBe(7);
  });

  it('treats a missing baseline as empty', () => {
    // Arrange
    const current: UsageState = {
      models: { 'anthropic/claude-opus': bucket({ input: 3 }) },
      tools: {},
    };

    // Act
    const delta = usageSince(current, undefined);

    // Assert
    expect(delta).toEqual(current);
  });
});
