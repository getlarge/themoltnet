import type { AxAIService } from '@ax-llm/ax';
import { describe, expect, it, vi } from 'vitest';

import { proposeNewTexts } from './propose-texts.js';

/**
 * Mock AI that returns a predetermined string as the newInstruction field.
 * ax() parses "New Instruction: <value>" from LLM text output.
 */
function createMockReflectionAI(responseText: string): AxAIService {
  return {
    getId: () => 'mock-reflection',
    getName: () => 'mock-reflection',
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
    getLastUsedChatModel: () => 'mock',
    getLastUsedEmbedModel: () => undefined,
    getLastUsedModelConfig: () => ({}),
    getOptions: () => ({}),
    setOptions: () => {},
    getModelInfo: () => [
      {
        name: 'mock',
        promptTokenCostPer1M: 0,
        completionTokenCostPer1M: 0,
      },
    ],
    embed: vi.fn().mockResolvedValue({ embeddings: [] }),
    // ax() parses output fields from "FieldName: value" format in LLM text
    chat: vi.fn().mockResolvedValue({
      results: [
        {
          content: `New Instruction: ${responseText}`,
          finishReason: 'stop',
          index: 0,
        },
      ],
      modelUsage: {
        ai: 'mock',
        model: 'mock',
        tokens: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
        },
      },
    }),
  } as unknown as AxAIService;
}

describe('proposeNewTexts', () => {
  it('returns empty when no reflectionAI is provided', async () => {
    const result = await proposeNewTexts({
      candidate: { instruction: 'current' },
      reflectiveDataset: {
        instruction: [{ Feedback: 'test failed' }],
      },
      componentsToUpdate: ['instruction'],
    });
    expect(result).toEqual({});
  });

  it('calls reflectionAI and returns proposed instruction', async () => {
    const mockAI = createMockReflectionAI(
      'This is the improved instruction text with enough length',
    );
    const result = await proposeNewTexts({
      reflectionAI: mockAI,
      candidate: { instruction: 'current instruction' },
      reflectiveDataset: {
        instruction: [
          {
            Inputs: { task_id: 'task-1' },
            'Generated Outputs': { score: 0.5 },
            Feedback: 'Test X failed: expected Y',
          },
        ],
      },
      componentsToUpdate: ['instruction'],
    });
    expect(result['instruction']).toBe(
      'This is the improved instruction text with enough length',
    );
  });

  it('skips components with empty reflective dataset', async () => {
    const mockAI = createMockReflectionAI('new text with enough chars');
    const result = await proposeNewTexts({
      reflectionAI: mockAI,
      candidate: { instruction: 'current' },
      reflectiveDataset: { instruction: [] },
      componentsToUpdate: ['instruction'],
    });
    expect(result).toEqual({});
  });

  it('skips components not in reflective dataset', async () => {
    const mockAI = createMockReflectionAI('new text with enough chars');
    const result = await proposeNewTexts({
      reflectionAI: mockAI,
      candidate: { instruction: 'current' },
      reflectiveDataset: {},
      componentsToUpdate: ['instruction'],
    });
    expect(result).toEqual({});
  });

  it('rejects instructions shorter than 16 chars', async () => {
    const mockAI = createMockReflectionAI('too short');
    const result = await proposeNewTexts({
      reflectionAI: mockAI,
      candidate: { instruction: 'current' },
      reflectiveDataset: {
        instruction: [{ Feedback: 'failed' }],
      },
      componentsToUpdate: ['instruction'],
    });
    expect(result).toEqual({});
  });

  it('handles multiple components', async () => {
    const mockAI = createMockReflectionAI(
      'A sufficiently long improved instruction',
    );
    const result = await proposeNewTexts({
      reflectionAI: mockAI,
      candidate: {
        instruction: 'current-a',
        system_prompt: 'current-b',
      },
      reflectiveDataset: {
        instruction: [{ Feedback: 'fix A' }],
        system_prompt: [{ Feedback: 'fix B' }],
      },
      componentsToUpdate: ['instruction', 'system_prompt'],
    });
    expect(result['instruction']).toBeTruthy();
    expect(result['system_prompt']).toBeTruthy();
  });
});
