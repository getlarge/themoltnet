import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { describe, expect, it, vi } from 'vitest';

import {
  applyPiModelOptions,
  configureDurableModelOptions,
} from '../../src/runtime/model-options-extension.js';

describe('applyPiModelOptions', () => {
  it.each([
    ['https://ollama.com/v1', 'openai-completions', 'max_tokens'],
    ['https://ollama.com/v1/', 'openai-completions', 'max_tokens'],
    ['https://other.example/v1', 'openai-completions', 'max_completion_tokens'],
    ['https://ollama.com/v1', 'openai-responses', 'max_completion_tokens'],
  ])(
    'honors output caps for legacy model declarations at %s using %s',
    async (baseUrl, api, field) => {
      const stream = vi.fn();
      const models = { streamSimple: stream } as unknown as ModelRuntime;
      configureDurableModelOptions(
        models,
        { maxOutputTokens: 2000 },
        'custom-provider',
        'custom-model',
        vi.fn(),
      );
      const selected = {
        provider: 'custom-provider',
        id: 'custom-model',
        baseUrl,
        api,
      };
      models.streamSimple(selected as never, {} as never);
      const payload = await stream.mock.calls[0][2].onPayload(
        { messages: [], max_completion_tokens: 99 },
        selected,
      );
      expect(payload[field]).toBe(2000);
      expect(
        Object.keys(payload).filter((key) => key.startsWith('max_')),
      ).toEqual([field]);
    },
  );
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

it('records only distinct scalar request controls and keeps observation failures nonfatal', async () => {
  const stream = vi.fn();
  const models = { streamSimple: stream } as unknown as ModelRuntime;
  const observe = vi.fn().mockRejectedValue(new Error('observer unavailable'));
  const warn = vi.fn();
  configureDurableModelOptions(
    models,
    {},
    'ollama-cloud',
    'mimo-v2.6-flash',
    warn,
    observe,
  );
  const model = { provider: 'ollama-cloud', id: 'mimo-v2.6-flash' };
  models.streamSimple(model as never, {} as never);
  const request = stream.mock.calls[0][2] as {
    onPayload: (p: unknown, m: unknown) => Promise<unknown>;
  };
  const payload = {
    model: model.id,
    messages: [{ content: 'private prompt' }],
    reasoning_effort: 'none',
    headers: { authorization: 'fixture' },
    max_tokens: 4096,
  };
  await expect(request.onPayload(payload, model)).resolves.toEqual(payload);
  await request.onPayload(payload, model);
  expect(observe).toHaveBeenCalledOnce();
  expect(observe).toHaveBeenCalledWith({
    provider: model.provider,
    model: model.id,
    reasoning_effort: 'none',
    max_tokens: 4096,
  });
  expect(warn).toHaveBeenCalledWith(
    { provider: model.provider, model: model.id },
    expect.any(String),
  );
});
