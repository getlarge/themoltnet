import type { AxChatResponse } from '@ax-llm/ax';
import type {
  AgentMessageItem,
  ThreadEvent,
  ThreadOptions,
  Usage,
} from '@openai/codex-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type MockTurn = {
  finalResponse: string;
  items: Array<{ type: string }>;
  usage: Usage | null;
};

type MockThread = {
  run: (input: string) => Promise<MockTurn>;
  runStreamed: (
    input: string,
  ) => Promise<{ events: AsyncGenerator<ThreadEvent> }>;
};

const runMock = vi.fn<(input: string) => Promise<MockTurn>>();
const runStreamedMock =
  vi.fn<(input: string) => Promise<{ events: AsyncGenerator<ThreadEvent> }>>();
const startThreadMock = vi.fn<(options?: ThreadOptions) => MockThread>();
const codexCtorMock = vi.fn();

vi.mock('@openai/codex-sdk', () => ({
  Codex: class MockCodex {
    constructor(options?: unknown) {
      codexCtorMock(options);
    }

    startThread(options?: ThreadOptions) {
      return startThreadMock(options);
    }
  },
}));

const { AxAICodexAgentSDK } = await import('./ax-codex-agent-sdk.js');

function agentMessage(text: string): AgentMessageItem {
  return {
    id: 'msg-1',
    type: 'agent_message',
    text,
  };
}

function usage(overrides: Partial<Usage> = {}): Usage {
  return {
    input_tokens: 100,
    cached_input_tokens: 20,
    output_tokens: 50,
    ...overrides,
  };
}

function turn(overrides: Partial<MockTurn> = {}): MockTurn {
  return {
    finalResponse: 'Hello world',
    items: [agentMessage('Hello world')],
    usage: usage(),
    ...overrides,
  };
}

function mockThread(
  opts: {
    runResult?: MockTurn;
    streamEvents?: ThreadEvent[];
    runError?: Error;
    streamError?: Error;
  } = {},
): void {
  runMock.mockImplementationOnce(() => {
    if (opts.runError) return Promise.reject(opts.runError);
    return Promise.resolve(turn(opts.runResult));
  });

  runStreamedMock.mockImplementationOnce(() => {
    if (opts.streamError) return Promise.reject(opts.streamError);
    return Promise.resolve({
      events: toAsyncGenerator(opts.streamEvents ?? []),
    });
  });

  startThreadMock.mockImplementationOnce(() => ({
    run: runMock,
    runStreamed: runStreamedMock,
  }));
}

function toAsyncGenerator<T>(values: T[]): AsyncGenerator<T> {
  return (async function* () {
    await Promise.resolve();
    for (const value of values) {
      yield value;
    }
  })();
}

function lastThreadOptions(): (ThreadOptions & { cwd?: string }) | undefined {
  return startThreadMock.mock.lastCall?.[0] as
    | (ThreadOptions & { cwd?: string })
    | undefined;
}

function lastRunPrompt(): string {
  return runMock.mock.lastCall?.[0] ?? '';
}

function lastCodexOptions():
  | {
      env?: Record<string, string>;
      apiKey?: string;
      codexPathOverride?: string;
    }
  | undefined {
  return codexCtorMock.mock.lastCall?.[0] as
    | {
        env?: Record<string, string>;
        apiKey?: string;
        codexPathOverride?: string;
      }
    | undefined;
}

async function drainStream(
  stream: ReadableStream<AxChatResponse>,
): Promise<AxChatResponse[]> {
  const reader = stream.getReader();
  const chunks: AxChatResponse[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return chunks;
}

describe('AxAICodexAgentSDK', () => {
  beforeEach(() => {
    runMock.mockReset();
    runStreamedMock.mockReset();
    startThreadMock.mockReset();
    codexCtorMock.mockReset();
  });

  describe('initialization', () => {
    it('uses default model and name', () => {
      const ai = new AxAICodexAgentSDK();
      expect(ai.getName()).toBe('codex-agent-sdk');
    });

    it('reports correct features', () => {
      const ai = new AxAICodexAgentSDK();
      const features = ai.getFeatures();
      expect(features.functions).toBe(false);
      expect(features.streaming).toBe(true);
      expect(features.thinking).toBe(false);
      expect(features.multiTurn).toBe(false);
      expect(features.caching.supported).toBe(false);
    });

    it('accepts custom model', () => {
      const ai = new AxAICodexAgentSDK({ model: 'gpt-5-codex-mini' });
      expect(ai.getName()).toBe('codex-agent-sdk');
    });

    it('starts with zero metrics', () => {
      const ai = new AxAICodexAgentSDK();
      const metrics = ai.getMetrics();
      expect(metrics.latency.chat.samples).toHaveLength(0);
      expect(metrics.errors.chat.total).toBe(0);
      expect(metrics.errors.chat.count).toBe(0);
    });
  });

  describe('non-streaming chat', () => {
    it('returns result text and token usage', async () => {
      mockThread();

      const ai = new AxAICodexAgentSDK();
      const resp = await ai.chat({
        chatPrompt: [{ role: 'user', content: 'Say hello' }],
        modelConfig: { stream: false },
      });

      expect(resp).not.toBeInstanceOf(ReadableStream);
      const r = resp as Exclude<typeof resp, ReadableStream>;
      expect(r.results[0]?.content).toBe('Hello world');
      expect(r.results[0]?.finishReason).toBe('stop');
      expect(r.modelUsage?.tokens?.promptTokens).toBe(100);
      expect(r.modelUsage?.tokens?.completionTokens).toBe(50);
      expect(r.modelUsage?.tokens?.totalTokens).toBe(150);
      expect(r.modelUsage?.tokens?.cacheReadTokens).toBe(20);
    });

    it('flattens system + user messages into prompt', async () => {
      mockThread();

      const ai = new AxAICodexAgentSDK();
      await ai.chat({
        chatPrompt: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'What is 2+2?' },
        ],
        modelConfig: { stream: false },
      });

      const prompt = lastRunPrompt();
      expect(prompt).toContain('You are helpful.');
      expect(prompt).toContain('What is 2+2?');
    });

    it('includes assistant and function messages in prompt', async () => {
      mockThread({
        runResult: turn({
          finalResponse: 'done',
          items: [agentMessage('done')],
        }),
      });

      const ai = new AxAICodexAgentSDK();
      const resp = await ai.chat({
        chatPrompt: [
          { role: 'user', content: 'Start' },
          { role: 'assistant', content: 'I will help.' },
          { role: 'function', functionId: 'fn-1', result: '42' },
          { role: 'user', content: 'Continue' },
        ],
        modelConfig: { stream: false },
      });

      const r = resp as Exclude<typeof resp, ReadableStream>;
      expect(r.results[0]?.content).toBe('done');

      const prompt = lastRunPrompt();
      expect(prompt).toContain('Assistant: I will help.');
      expect(prompt).toContain('42');
    });

    it('handles multi-block user content', async () => {
      mockThread({
        runResult: turn({
          finalResponse: 'parsed',
          items: [agentMessage('parsed')],
        }),
      });

      const ai = new AxAICodexAgentSDK();
      const resp = await ai.chat({
        chatPrompt: [
          {
            role: 'user',
            content: [
              { type: 'text' as const, text: 'Part one' },
              { type: 'text' as const, text: 'Part two' },
            ],
          },
        ],
        modelConfig: { stream: false },
      });

      const r = resp as Exclude<typeof resp, ReadableStream>;
      expect(r.results[0]?.content).toBe('parsed');

      const prompt = lastRunPrompt();
      expect(prompt).toContain('Part one');
      expect(prompt).toContain('Part two');
    });

    it('uses last agent message when final response is empty', async () => {
      mockThread({
        runResult: turn({
          finalResponse: '',
          items: [agentMessage('fallback text')],
        }),
      });

      const ai = new AxAICodexAgentSDK();
      const resp = await ai.chat({
        chatPrompt: [{ role: 'user', content: 'test' }],
        modelConfig: { stream: false },
      });

      const r = resp as Exclude<typeof resp, ReadableStream>;
      expect(r.results[0]?.content).toBe('fallback text');
    });

    it('returns empty string when no messages', async () => {
      mockThread({
        runResult: turn({ finalResponse: '', items: [], usage: null }),
      });

      const ai = new AxAICodexAgentSDK();
      const resp = await ai.chat({
        chatPrompt: [{ role: 'user', content: 'empty' }],
        modelConfig: { stream: false },
      });

      const r = resp as Exclude<typeof resp, ReadableStream>;
      expect(r.results[0]?.content).toBe('');
    });
  });

  describe('streaming chat', () => {
    it('streams text items and returns usage on final chunk', async () => {
      mockThread({
        streamEvents: [
          {
            type: 'item.completed',
            item: agentMessage('Hello'),
          },
          {
            type: 'item.completed',
            item: agentMessage(' world'),
          },
          {
            type: 'turn.completed',
            usage: usage({
              input_tokens: 200,
              cached_input_tokens: 5,
              output_tokens: 80,
            }),
          },
        ],
      });

      const ai = new AxAICodexAgentSDK();
      const resp = await ai.chat({
        chatPrompt: [{ role: 'user', content: 'stream test' }],
        modelConfig: { stream: true },
      });

      expect(resp).toBeInstanceOf(ReadableStream);
      const chunks = await drainStream(resp as ReadableStream<AxChatResponse>);

      expect(chunks.length).toBeGreaterThanOrEqual(2);

      const textChunks = chunks.filter(
        (c) =>
          c.results[0]?.content !== undefined &&
          c.results[0].content.length > 0,
      );
      expect(textChunks.length).toBeGreaterThanOrEqual(1);

      const finalChunk = chunks.find((c) => c.modelUsage !== undefined);
      expect(finalChunk).toBeDefined();
      expect(finalChunk!.modelUsage?.tokens?.promptTokens).toBe(200);
      expect(finalChunk!.modelUsage?.tokens?.completionTokens).toBe(80);
      expect(finalChunk!.modelUsage?.tokens?.totalTokens).toBe(280);
      expect(finalChunk!.modelUsage?.tokens?.cacheReadTokens).toBe(5);
    });

    it('handles empty stream gracefully', async () => {
      mockThread({ streamEvents: [] });

      const ai = new AxAICodexAgentSDK();
      const resp = await ai.chat({
        chatPrompt: [{ role: 'user', content: 'empty stream' }],
        modelConfig: { stream: true },
      });

      expect(resp).toBeInstanceOf(ReadableStream);
      const chunks = await drainStream(resp as ReadableStream<AxChatResponse>);
      expect(chunks).toHaveLength(0);
    });
  });

  describe('metrics', () => {
    it('tracks latency after chat call', async () => {
      mockThread({
        runResult: turn({ finalResponse: 'ok', items: [agentMessage('ok')] }),
      });

      const ai = new AxAICodexAgentSDK();
      await ai.chat({
        chatPrompt: [{ role: 'user', content: 'metrics test' }],
        modelConfig: { stream: false },
      });

      const metrics = ai.getMetrics();
      expect(metrics.latency.chat.samples).toHaveLength(1);
      expect(metrics.latency.chat.mean).toBeGreaterThan(0);
      expect(metrics.errors.chat.total).toBe(1);
      expect(metrics.errors.chat.count).toBe(0);
      expect(metrics.errors.chat.rate).toBe(0);
    });

    it('tracks errors on sdk failure', async () => {
      mockThread({
        runError: new Error('Codex connection failed'),
      });

      const ai = new AxAICodexAgentSDK();
      await expect(
        ai.chat({
          chatPrompt: [{ role: 'user', content: 'error test' }],
          modelConfig: { stream: false },
        }),
      ).rejects.toThrow('Codex connection failed');

      const metrics = ai.getMetrics();
      expect(metrics.errors.chat.total).toBe(1);
      expect(metrics.errors.chat.count).toBe(1);
      expect(metrics.errors.chat.rate).toBe(1);
    });

    it('accumulates metrics across multiple calls', async () => {
      mockThread({
        runResult: turn({
          finalResponse: 'first',
          items: [agentMessage('first')],
        }),
      });
      mockThread({
        runResult: turn({
          finalResponse: 'second',
          items: [agentMessage('second')],
        }),
      });

      const ai = new AxAICodexAgentSDK();

      await ai.chat({
        chatPrompt: [{ role: 'user', content: 'call 1' }],
        modelConfig: { stream: false },
      });
      await ai.chat({
        chatPrompt: [{ role: 'user', content: 'call 2' }],
        modelConfig: { stream: false },
      });

      const metrics = ai.getMetrics();
      expect(metrics.latency.chat.samples).toHaveLength(2);
      expect(metrics.errors.chat.total).toBe(2);
      expect(metrics.errors.chat.count).toBe(0);
    });
  });

  describe('sdk options', () => {
    it('passes model to the codex thread', async () => {
      mockThread();

      const ai = new AxAICodexAgentSDK({ model: 'gpt-5-codex-mini' });
      await ai.chat({
        chatPrompt: [{ role: 'user', content: 'model test' }],
        modelConfig: { stream: false },
      });

      expect(lastThreadOptions()?.model).toBe('gpt-5-codex-mini');
    });

    it('uses read-only sandbox and no approvals', async () => {
      mockThread();

      const ai = new AxAICodexAgentSDK();
      await ai.chat({
        chatPrompt: [{ role: 'user', content: 'sandbox test' }],
        modelConfig: { stream: false },
      });

      expect(lastThreadOptions()?.sandboxMode).toBe('read-only');
      expect(lastThreadOptions()?.approvalPolicy).toBe('never');
      expect(lastThreadOptions()?.networkAccessEnabled).toBe(false);
      expect(lastThreadOptions()?.skipGitRepoCheck).toBe(true);
    });

    it('passes cwd to the codex thread', async () => {
      mockThread();

      const ai = new AxAICodexAgentSDK({ cwd: '/tmp/codex-eval' });
      await ai.chat({
        chatPrompt: [{ role: 'user', content: 'cwd test' }],
        modelConfig: { stream: false },
      });

      expect(lastThreadOptions()?.cwd).toBe('/tmp/codex-eval');
    });

    it('allows overriding sandbox mode', async () => {
      mockThread();

      const ai = new AxAICodexAgentSDK({ sandboxMode: 'full' });
      await ai.chat({
        chatPrompt: [{ role: 'user', content: 'sandbox override test' }],
        modelConfig: { stream: false },
      });

      expect(lastThreadOptions()?.sandboxMode).toBe('full');
    });

    it('injects maxTurns into the adapter prompt', async () => {
      mockThread();

      const ai = new AxAICodexAgentSDK({ maxTurns: 5 });
      await ai.chat({
        chatPrompt: [{ role: 'user', content: 'turns test' }],
        modelConfig: { stream: false },
      });

      expect(lastRunPrompt()).toContain(
        'Limit yourself to 5 internal turn(s) if possible.',
      );
    });

    it('disables telemetry in the sdk env', async () => {
      mockThread();

      const ai = new AxAICodexAgentSDK();
      await ai.chat({
        chatPrompt: [{ role: 'user', content: 'env test' }],
        modelConfig: { stream: false },
      });

      expect(lastCodexOptions()?.env?.OTEL_SDK_DISABLED).toBe('true');
      expect(lastCodexOptions()?.env?.OPENAI_DISABLE_TELEMETRY).toBe('1');
    });

    it('merges extra env vars into the sdk env', async () => {
      mockThread();

      const ai = new AxAICodexAgentSDK({ extraEnv: { FOO: 'bar' } });
      await ai.chat({
        chatPrompt: [{ role: 'user', content: 'env override test' }],
        modelConfig: { stream: false },
      });

      expect(lastCodexOptions()?.env?.FOO).toBe('bar');
    });
  });

  describe('token usage', () => {
    it('handles missing usage gracefully', async () => {
      mockThread({
        runResult: turn({ finalResponse: 'done', usage: null }),
      });

      const ai = new AxAICodexAgentSDK();
      const resp = await ai.chat({
        chatPrompt: [{ role: 'user', content: 'no usage' }],
        modelConfig: { stream: false },
      });

      const r = resp as Exclude<typeof resp, ReadableStream>;
      expect(r.modelUsage?.tokens?.promptTokens).toBe(0);
      expect(r.modelUsage?.tokens?.completionTokens).toBe(0);
    });
  });
});
