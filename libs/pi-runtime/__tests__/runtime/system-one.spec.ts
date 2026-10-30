import type { ClassifierContext, ClassifierModel } from '@earendil-works/pi-ai';
import { describe, expect, it, vi } from 'vitest';

import { classify } from '../../src/runtime/system-one.js';

const model: ClassifierModel<'typesafe-system-one'> = {
  id: 'nimble',
  name: 'Nimble',
  provider: 'ollama',
  api: 'typesafe-system-one',
  type: 'classifier',
  baseUrl: 'http://localhost:11434/v1/',
  contextWindow: 8192,
  input: ['text'],
  cost: { input: 2, output: 4, cacheRead: 0, cacheWrite: 0 },
};
const context: ClassifierContext = {
  state: { ticket: 'broken' },
  questions: {
    label: {
      type: 'choice',
      instructions: 'Choose',
      criteria: { bug: 'Broken', other: 'Other' },
    },
    urgency: {
      type: 'score',
      instructions: 'Score',
      criteria: ['Low', 'High'],
    },
    actionable: {
      type: 'bool',
      instructions: 'Actionable?',
      criteria: { true: 'Yes', false: 'No' },
    },
  },
};
const answers = {
  label: {
    type: 'choice',
    choice: 'bug',
    probabilities: { bug: 0.8, other: 0.2 },
    confidence: 0.6,
  },
  urgency: { type: 'score', score: 0.8, confidence: 0.6 },
  actionable: { type: 'noul', noul: 0.8 },
};
const success = () =>
  Response.json(
    { answers, usage: { input_tokens: 100, output_tokens: 2 } },
    { headers: { 'x-response-id': 'response-1' } },
  );

function requestBody(init: RequestInit | undefined): string {
  if (typeof init?.body !== 'string') throw new Error('Expected JSON body');
  return init.body;
}

describe('anonymous System One compatibility', () => {
  it('maps bool questions, parses all answers and prices usage without an Authorization header', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(success());
    const result = await classify(model, context, { apiKey: '', fetch });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBeInstanceOf(URL);
    expect((url as URL).href).toBe('http://localhost:11434/v1/systemone');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('authorization')).toBeNull();
    expect(JSON.parse(requestBody(init))).toMatchObject({
      model: 'nimble',
      state: context.state,
      questions: {
        actionable: { ...context.questions.actionable, type: 'noul' },
      },
    });
    expect(result).toMatchObject({
      stopReason: 'stop',
      answers: { ...answers, actionable: { type: 'bool', probability: 0.8 } },
      usage: {
        input: 100,
        output: 2,
        totalTokens: 102,
        cost: {
          input: expect.closeTo(0.0002, 10) as unknown,
          output: 0.000008,
          total: 0.000208,
        },
      },
    });
  });

  it('preserves model/options headers, payload transforms and response callbacks', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(success());
    const onPayload = vi.fn(() => ({ model: 'nimble', transformed: true }));
    const onResponse = vi.fn();
    const result = await classify(
      { ...model, headers: { 'x-model': 'yes', 'x-precedence': 'model' } },
      context,
      {
        apiKey: '',
        fetch,
        headers: { 'x-options': 'yes', 'X-Precedence': 'options' },
        onPayload,
        onResponse,
      },
    );
    expect(result.stopReason).toBe('stop');
    const headers = new Headers(fetch.mock.calls[0][1]?.headers);
    expect(headers.get('x-model')).toBe('yes');
    expect(headers.get('x-options')).toBe('yes');
    expect(headers.get('x-precedence')).toBe('options');
    expect(JSON.parse(requestBody(fetch.mock.calls[0][1]))).toEqual({
      model: 'nimble',
      transformed: true,
    });
    expect(onPayload).toHaveBeenCalledOnce();
    expect(onResponse).toHaveBeenCalledWith(
      {
        status: 200,
        headers: expect.objectContaining({
          'x-response-id': 'response-1',
        }) as unknown,
      },
      expect.objectContaining({ id: 'nimble' }),
    );
  });

  it.each(['model', 'options'] as const)(
    'preserves explicit authorization from %s headers',
    async (source) => {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(success());
      const headers = { Authorization: 'Bearer explicit-test-key' };
      await classify(
        { ...model, ...(source === 'model' ? { headers } : {}) },
        context,
        { apiKey: '', fetch, ...(source === 'options' ? { headers } : {}) },
      );
      expect(
        new Headers(fetch.mock.calls[0][1]?.headers).get('authorization'),
      ).toBe('Bearer explicit-test-key');
    },
  );

  it.each(['assets', 'state-image-urls'] as const)(
    'uses Pi image encoding for anonymous classifiers with %s compatibility',
    async (imageInput) => {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(success());
      const result = await classify(
        {
          ...model,
          input: ['text', 'image'],
          compat: { imageInput, sendImageOptInHeader: true },
        },
        {
          ...context,
          images: [{ type: 'image', mimeType: 'image/png', data: 'aW1hZ2U=' }],
        },
        { apiKey: '', fetch },
      );
      expect(result.stopReason).toBe('stop');
      const init = fetch.mock.calls[0][1];
      const payload = JSON.parse(requestBody(init));
      if (imageInput === 'assets') {
        expect(payload.assets).toEqual({
          '<image-1>': {
            type: 'image',
            format: 'png',
            data_base64: 'aW1hZ2U=',
          },
        });
        expect(payload.state).toEqual(['<image-1>', context.state]);
      } else {
        expect(payload.state).toEqual([
          {
            type: 'image_url',
            image_url: { url: 'data:image/png;base64,aW1hZ2U=' },
          },
          context.state,
        ]);
        expect(payload).not.toHaveProperty('assets');
      }
      const headers = new Headers(init?.headers);
      expect(headers.get('authorization')).toBeNull();
      expect(headers.get('TypeSafe-Danger-Zone-Images')).toBe('true');
    },
  );

  it('delegates keyed requests and retains missing-key failures', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(success());
    expect(
      (await classify(model, context, { apiKey: 'real-key', fetch }))
        .stopReason,
    ).toBe('stop');
    expect(
      new Headers(fetch.mock.calls[0][1]?.headers).get('authorization'),
    ).toBe('Bearer real-key');
    fetch.mockClear();
    expect(await classify(model, context, { fetch })).toMatchObject({
      stopReason: 'error',
      errorMessage: expect.stringContaining('No API key') as unknown,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { ...answers, label: { ...answers.label, probabilities: { bug: 'bad' } } },
    { ...answers, label: { ...answers.label, confidence: null } },
    { ...answers, urgency: { ...answers.urgency, score: null } },
    { ...answers, actionable: { type: 'bool', probability: 0.8 } },
  ])('retains billed usage when answers are malformed: %j', async (invalid) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      Response.json({
        answers: invalid,
        usage: { input_tokens: 100, output_tokens: 2 },
      }),
    );
    const result = await classify(model, context, { apiKey: '', fetch });
    expect(result.stopReason).toBe('error');
    expect(result.errorMessage).toBeTruthy();
    expect(result.usage).toMatchObject({ input: 100, output: 2 });
    expect(result.answers).toEqual({});
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('normalizes malformed usage counts without discarding valid answers', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      Response.json({
        answers,
        usage: { input_tokens: -1, output_tokens: 'bad' },
      }),
    );
    const result = await classify(model, context, { apiKey: '', fetch });
    expect(result.stopReason).toBe('stop');
    expect(result.usage).toMatchObject({ input: 0, output: 0, totalTokens: 0 });
  });

  it('retries transient HTTP failures with the provider retry policy', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response('busy', {
          status: 503,
          headers: { 'retry-after-ms': '1' },
        }),
      )
      .mockResolvedValueOnce(success());
    const result = await classify(model, context, {
      apiKey: '',
      fetch,
      maxRetries: 1,
    });
    expect(result.stopReason).toBe('stop');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('honors retry limits and formats HTTP error bodies', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response('{"error":"busy"}', { status: 503 }));
    const result = await classify(model, context, {
      apiKey: '',
      fetch,
      maxRetries: 0,
    });
    expect(result).toMatchObject({
      stopReason: 'error',
      errorMessage: expect.stringContaining('busy') as unknown,
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('rejects server retry delays above the configured maximum', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response('busy', {
        status: 429,
        headers: { 'retry-after-ms': '1000' },
      }),
    );
    const result = await classify(model, context, {
      apiKey: '',
      fetch,
      maxRetryDelayMs: 10,
    });
    expect(result.errorMessage).toContain('retry delay');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('times out a request and reports caller cancellation distinctly', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) reject(new Error('Request aborted'));
          else
            signal?.addEventListener(
              'abort',
              () => reject(new Error('Request aborted')),
              {
                once: true,
              },
            );
        }),
    );
    const result = await classify(model, context, {
      apiKey: '',
      fetch,
      timeoutMs: 5,
      maxRetries: 0,
    });
    expect(result).toMatchObject({
      stopReason: 'error',
      errorMessage: expect.stringContaining('timed out after 5ms') as unknown,
    });
    const aborted = await classify(model, context, {
      apiKey: '',
      fetch,
      signal: AbortSignal.abort(),
      timeoutMs: 5,
    });
    expect(aborted.stopReason).toBe('aborted');
  });

  it('rejects malformed response bodies and other protocol models', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json([]));
    expect(
      (await classify(model, context, { apiKey: '', fetch })).errorMessage,
    ).toContain('unexpected response');
    fetch.mockClear();
    expect(
      (
        await classify({ ...model, api: 'llama-cpp-classify' }, context, {
          apiKey: '',
          fetch,
        })
      ).errorMessage,
    ).toContain('Unsupported classifier API');
    expect(fetch).not.toHaveBeenCalled();
  });
});
