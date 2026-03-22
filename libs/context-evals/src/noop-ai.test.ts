import { describe, expect, it } from 'vitest';

import { buildNoopAI } from './noop-ai.js';

describe('buildNoopAI', () => {
  it('returns an AxAIService with name noop', () => {
    const ai = buildNoopAI();
    expect(ai.getName()).toBe('noop');
    expect(ai.getId()).toBe('noop');
  });

  it('chat returns empty JSON with zero tokens', async () => {
    const ai = buildNoopAI();
    const raw = await ai.chat({
      chatPrompt: [{ role: 'user', content: 'hello' }],
    });
    // Noop AI always returns a non-streaming response
    const result = raw as unknown as {
      results: Array<{ content: string }>;
      modelUsage?: { tokens: { totalTokens: number } };
    };
    expect(result.results).toHaveLength(1);
    expect(result.results[0].content).toBe('{}');
    expect(result.modelUsage?.tokens.totalTokens).toBe(0);
  });

  it('getFeatures reports no capabilities', () => {
    const ai = buildNoopAI();
    const features = ai.getFeatures();
    expect(features.functions).toBe(false);
    expect(features.streaming).toBe(false);
  });

  it('embed returns empty embeddings', async () => {
    const ai = buildNoopAI();
    const result = await ai.embed({ texts: ['test'] });
    expect(result.embeddings).toEqual([]);
  });
});
