import type { TaskUsage } from '@moltnet/tasks';

/** The attempt fields spend is read from; any task type, any status. */
export interface SpendAttempt {
  usage: TaskUsage | null;
  claimedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

/**
 * What a producer task cost across every attempt it took, failed retries
 * included: an eval comparing models must charge a model for the attempts it
 * needed, not only the accepted one.
 */
export interface ProducerSpend {
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  /** Sum of harness cost estimates, USD; a lower bound unless `costComplete`. */
  estimatedCostUsd: number;
  /** False when any attempt with token usage was unpriced or partly priced. */
  costComplete: boolean;
  /** Summed attempt wall time, start (or claim) to completion. */
  durationMs: number;
}

export function summarizeProducerSpend(
  attempts: readonly SpendAttempt[],
): ProducerSpend {
  const spend: ProducerSpend = {
    attempts: attempts.length,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    estimatedCostUsd: 0,
    costComplete: true,
    durationMs: 0,
  };
  for (const attempt of attempts) {
    const usage = attempt.usage;
    if (usage) {
      spend.inputTokens += usage.inputTokens;
      spend.outputTokens += usage.outputTokens;
      spend.cacheReadTokens += usage.cacheReadTokens ?? 0;
      spend.cacheWriteTokens += usage.cacheWriteTokens ?? 0;
      spend.reasoningTokens += usage.reasoningTokens ?? 0;
      spend.estimatedCostUsd += usage.cost?.total ?? 0;
      if (usage.inputTokens + usage.outputTokens > 0 && !usage.cost?.complete)
        spend.costComplete = false;
    }
    const start = Date.parse(attempt.startedAt ?? attempt.claimedAt);
    const end = attempt.completedAt ? Date.parse(attempt.completedAt) : NaN;
    if (Number.isFinite(start) && Number.isFinite(end) && end > start)
      spend.durationMs += end - start;
  }
  return spend;
}

/** Sum several producers' spend, e.g. every run of one scenario. */
export function mergeProducerSpend(
  spends: readonly ProducerSpend[],
): ProducerSpend {
  return spends.reduce<ProducerSpend>(
    (total, spend) => ({
      attempts: total.attempts + spend.attempts,
      inputTokens: total.inputTokens + spend.inputTokens,
      outputTokens: total.outputTokens + spend.outputTokens,
      cacheReadTokens: total.cacheReadTokens + spend.cacheReadTokens,
      cacheWriteTokens: total.cacheWriteTokens + spend.cacheWriteTokens,
      reasoningTokens: total.reasoningTokens + spend.reasoningTokens,
      estimatedCostUsd: total.estimatedCostUsd + spend.estimatedCostUsd,
      costComplete: total.costComplete && spend.costComplete,
      durationMs: total.durationMs + spend.durationMs,
    }),
    summarizeProducerSpend([]),
  );
}

/** `tokens=… cost=$…` for summaries; `≥` marks a cost missing some usage. */
export function formatProducerSpend(spend: ProducerSpend): string {
  const tokens = spend.inputTokens + spend.outputTokens;
  const cost =
    spend.estimatedCostUsd > 0 || spend.costComplete
      ? `${spend.costComplete ? '' : '≥'}$${spend.estimatedCostUsd.toFixed(4)}`
      : 'unpriced';
  return `tokens=${tokens} cost=${cost} attempts=${spend.attempts}`;
}
