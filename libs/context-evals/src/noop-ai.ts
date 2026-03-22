import type { AxAIService, AxModelInfo } from '@ax-llm/ax';

const NOOP_MODEL_INFO: AxModelInfo[] = [
  {
    name: 'noop',
    currency: 'usd',
    characterIsToken: true,
    promptTokenCostPer1M: 0,
    completionTokenCostPer1M: 0,
  },
];

/**
 * No-op AxAIService that returns instantly with zero cost.
 *
 * Used as the studentAI when an adapter is configured — ax-llm's
 * evalBatch() unconditionally calls program.forward(studentAI) but
 * our metricFn ignores the prediction. This avoids wasting real LLM
 * calls on a dummy scaffold program.
 */
export function buildNoopAI(): AxAIService {
  return {
    getId: () => 'noop',
    getName: () => 'noop',
    getFeatures: () => ({ functions: false, streaming: false }),
    getModelList: () => [],
    getMetrics: () => ({
      latency: {
        chat: { mean: 0, p95: 0, p99: 0, samples: [] },
        embed: { mean: 0, p95: 0, p99: 0, samples: [] },
      },
      errors: {
        chat: { count: 0, rate: 0, total: 0 },
        embed: { count: 0, rate: 0, total: 0 },
      },
    }),
    getLogger: () => () => {},
    getLastUsedChatModel: () => 'noop',
    getLastUsedEmbedModel: () => undefined,
    getLastUsedModelConfig: () => ({}),
    getOptions: () => ({}),
    setOptions: () => {},
    getModelInfo: () => NOOP_MODEL_INFO,
    // eslint-disable-next-line @typescript-eslint/require-await
    embed: async () => ({ embeddings: [] }),
    // eslint-disable-next-line @typescript-eslint/require-await
    chat: async () => ({
      results: [{ content: '{}', finishReason: 'stop' as const, index: 0 }],
      modelUsage: {
        ai: 'noop',
        model: 'noop',
        tokens: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
        },
      },
    }),
  } as unknown as AxAIService;
}
