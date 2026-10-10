import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { describe, expect, it, vi } from 'vitest';

import {
  applyPiModelOptions,
  configureDurableModelOptions,
} from './model-options-extension.js';

describe('applyPiModelOptions', () => {
  it('applies OpenAI-compatible sampling and output caps without top-k', () => {
    const payload = {
      model: 'gpt-5.2',
      messages: [],
      max_completion_tokens: 4096,
    };

    expect(
      applyPiModelOptions(payload, {
        temperature: 0.2,
        topP: 0.9,
        topK: 40,
        maxOutputTokens: 12_000,
      }),
    ).toEqual({
      model: 'gpt-5.2',
      messages: [],
      temperature: 0.2,
      top_p: 0.9,
      max_completion_tokens: 12_000,
    });
  });

  it('does not add sampling controls to explicit reasoning payloads', () => {
    expect(
      applyPiModelOptions(
        {
          model: 'gpt-5.2',
          messages: [],
          reasoning_effort: 'high',
          max_completion_tokens: 4096,
        },
        { temperature: 0.2, topP: 0.9, topK: 40, maxOutputTokens: 12_000 },
      ),
    ).toEqual({
      model: 'gpt-5.2',
      messages: [],
      reasoning_effort: 'high',
      max_completion_tokens: 12_000,
    });
  });

  it('applies Google generation config fields including top-k', () => {
    expect(
      applyPiModelOptions(
        { model: 'gemini-3-pro', contents: [], config: {} },
        {
          temperature: 0.2,
          topP: 0.9,
          topK: 40,
          maxOutputTokens: 12_000,
        },
      ),
    ).toEqual({
      model: 'gemini-3-pro',
      contents: [],
      config: {
        temperature: 0.2,
        topP: 0.9,
        topK: 40,
        maxOutputTokens: 12_000,
      },
    });
  });

  it('applies Anthropic top-k only when thinking is not enabled', () => {
    expect(
      applyPiModelOptions(
        {
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 4096,
          messages: [],
        },
        { topK: 40 },
      ),
    ).toMatchObject({ top_k: 40 });

    expect(
      applyPiModelOptions(
        {
          anthropic_version: 'bedrock-2023-05-31',
          thinking: { type: 'enabled', budget_tokens: 1024 },
          max_tokens: 4096,
          messages: [],
        },
        { temperature: 0.2, topP: 0.9, topK: 40 },
      ),
    ).not.toHaveProperty('top_k');

    expect(
      applyPiModelOptions(
        {
          anthropic_version: 'bedrock-2023-05-31',
          thinking: { type: 'disabled' },
          max_tokens: 4096,
          messages: [],
        },
        { temperature: 0.2, topP: 0.9, topK: 40 },
      ),
    ).toMatchObject({
      temperature: 0.2,
      top_p: 0.9,
      top_k: 40,
    });
  });

  it('leaves payloads unchanged when no model options are set', () => {
    expect(
      applyPiModelOptions({ model: 'gpt-5.2', messages: [] }, {}),
    ).toBeUndefined();
  });
});

it('applies profile sampling to Durable provider payloads while preserving an existing transform', async () => {
  const stream = vi.fn();
  const models = { streamSimple: stream } as unknown as ModelRuntime;
  const warn = vi.fn();
  configureDurableModelOptions(
    models,
    { temperature: 0.2, topP: 0.9, topK: 40, maxOutputTokens: 4000 },
    'ollama-cloud',
    'gpt-oss:120b',
    warn,
  );
  const model = { provider: 'ollama-cloud', id: 'gpt-oss:120b' };
  models.streamSimple(model as never, {} as never, {
    onPayload: () => ({ model: 'gpt-oss:120b', messages: [], existing: true }),
  });
  const request = stream.mock.calls[0][2] as {
    onPayload: (payload: unknown, model: unknown) => Promise<unknown>;
  };
  expect(await request.onPayload({}, model)).toEqual({
    model: 'gpt-oss:120b',
    messages: [],
    existing: true,
    temperature: 0.2,
    top_p: 0.9,
    max_tokens: 4000,
  });
  expect(warn).toHaveBeenCalledWith(
    expect.objectContaining({ option: 'topK' }),
    expect.any(String),
  );
});
