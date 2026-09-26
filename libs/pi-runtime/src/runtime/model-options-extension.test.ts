import { describe, expect, it, vi } from 'vitest';

import {
  applyPiModelOptions,
  createPiModelOptionsExtension,
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

  it('omits unsupported Codex options and warns once per session', () => {
    let beforeRequest: (event: { payload: unknown }) => unknown;
    const warn = vi.fn();
    createPiModelOptionsExtension(
      { maxOutputTokens: 4000, temperature: 0.2 },
      'openai-codex',
      'gpt-5.6-terra',
      warn,
    )({
      on: (_event: string, handler: (event: { payload: unknown }) => unknown) =>
        (beforeRequest = handler),
    } as never);

    const payload = { model: 'gpt-5.6-terra', input: [] };
    expect(beforeRequest!({ payload })).toBeUndefined();
    expect(beforeRequest!({ payload })).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        option: 'maxOutputTokens',
        provider: 'openai-codex',
        model: 'gpt-5.6-terra',
      }),
      expect.any(String),
    );
  });
});
