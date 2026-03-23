import type {
  McpServerConfig,
  SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { AxChatResponse } from '@ax-llm/ax';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ResultPayload } from './sdk-types.js';

// ── Mock Agent SDK ───────────────────────────────────────────────────────────

/**
 * Build a mock async iterable that yields SDKMessage events, mimicking the
 * Agent SDK's `query()` return value.
 */
function mockQueryResult(
  messages: SDKMessage[],
): AsyncIterable<SDKMessage> & { close(): void } {
  let closed = false;
  return {
    close() {
      closed = true;
    },
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        next() {
          if (closed || i >= messages.length) {
            return Promise.resolve({
              done: true as const,
              value: undefined,
            });
          }
          return Promise.resolve({
            done: false as const,
            value: messages[i++],
          });
        },
      };
    },
  };
}

/** Shorthand for an assistant SDKMessage with text content blocks. */
function assistantMessage(text: string): SDKMessage {
  return {
    type: 'assistant',
    session_id: 'test-session',
    message: {
      content: [{ type: 'text', text }],
    },
  } as unknown as SDKMessage;
}

/** Shorthand for a result SDKMessage. */
function resultMessage(overrides: Partial<ResultPayload> = {}): SDKMessage {
  return {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'Test result',
    num_turns: 1,
    duration_ms: 500,
    duration_api_ms: 400,
    total_cost_usd: 0.001,
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 10,
      cache_read_input_tokens: 20,
    },
    ...overrides,
  } as unknown as SDKMessage;
}

const mockQuery = vi.fn<any>();

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  query: (...args: unknown[]) => mockQuery(...args),
}));

// ── Import after mock ────────────────────────────────────────────────────────

// Dynamic import required: vi.mock() must be set up before the module loads.
const { AxAIClaudeAgentSDK } = await import('./ax-claude-agent-sdk.js');

// ── Helpers ──────────────────────────────────────────────────────────────────

interface QueryCallArgs {
  prompt?: string;
  options?: {
    model?: string;
    tools?: string[] | { type: 'preset'; preset: 'claude_code' };
    maxTurns?: number;
    permissionMode?: string;
    cwd?: string;
    mcpServers?: Record<string, unknown>;
    env?: Record<string, string>;
  };
}

function lastQueryCallArgs(): QueryCallArgs {
  return mockQuery.mock.lastCall?.[0] as QueryCallArgs;
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

// ── Tests ────────────────────────────────────────────────────────────────────

describe('AxAIClaudeAgentSDK', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  // ── Initialization ──────────────────────────────────────────────────────

  describe('initialization', () => {
    it('uses default model and name', () => {
      const ai = new AxAIClaudeAgentSDK();
      expect(ai.getName()).toBe('claude-agent-sdk');
    });

    it('reports correct features', () => {
      const ai = new AxAIClaudeAgentSDK();
      const features = ai.getFeatures();
      expect(features.functions).toBe(false);
      expect(features.streaming).toBe(true);
      expect(features.thinking).toBe(false);
      expect(features.multiTurn).toBe(false);
      expect(features.caching.supported).toBe(false);
    });

    it('accepts custom model', () => {
      const ai = new AxAIClaudeAgentSDK({ model: 'claude-opus-4-6' });
      expect(ai.getName()).toBe('claude-agent-sdk');
    });

    it('starts with zero metrics', () => {
      const ai = new AxAIClaudeAgentSDK();
      const metrics = ai.getMetrics();
      expect(metrics.latency.chat.samples).toHaveLength(0);
      expect(metrics.errors.chat.total).toBe(0);
      expect(metrics.errors.chat.count).toBe(0);
    });
  });

  // ── Non-streaming chat ──────────────────────────────────────────────────

  describe('non-streaming chat', () => {
    it('returns result text and token usage', async () => {
      mockQuery.mockReturnValueOnce(
        mockQueryResult([
          assistantMessage('Hello world'),
          resultMessage({ result: 'Hello world' }),
        ]),
      );

      const ai = new AxAIClaudeAgentSDK();
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
      expect(r.modelUsage?.tokens?.cacheCreationTokens).toBe(10);
      expect(r.modelUsage?.tokens?.cacheReadTokens).toBe(20);
    });

    it('flattens system + user messages into prompt', async () => {
      mockQuery.mockReturnValueOnce(
        mockQueryResult([resultMessage({ result: 'ok' })]),
      );

      const ai = new AxAIClaudeAgentSDK();
      await ai.chat({
        chatPrompt: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'What is 2+2?' },
        ],
        modelConfig: { stream: false },
      });

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const args = lastQueryCallArgs();
      expect(args).toBeDefined();
      expect(args.prompt).toContain('You are helpful.');
      expect(args.prompt).toContain('What is 2+2?');
    });

    it('includes assistant and function messages in prompt', async () => {
      mockQuery.mockReturnValueOnce(
        mockQueryResult([resultMessage({ result: 'done' })]),
      );

      const ai = new AxAIClaudeAgentSDK();
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

      // AxBaseAI converts function results to user messages (prompt
      // emulation since functions: false), so the flattened prompt
      // contains the raw result text rather than the wrapper.
      const args = lastQueryCallArgs();
      expect(args.prompt).toContain('Assistant: I will help.');
      expect(args.prompt).toContain('42');
    });

    it('handles multi-block user content', async () => {
      mockQuery.mockReturnValueOnce(
        mockQueryResult([resultMessage({ result: 'parsed' })]),
      );

      const ai = new AxAIClaudeAgentSDK();
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

      const args = lastQueryCallArgs();
      expect(args.prompt).toContain('Part one');
      expect(args.prompt).toContain('Part two');
    });

    it('uses last assistant text when result has no result field', async () => {
      mockQuery.mockReturnValueOnce(
        mockQueryResult([
          assistantMessage('fallback text'),
          resultMessage({ result: undefined, subtype: 'success' }),
        ]),
      );

      const ai = new AxAIClaudeAgentSDK();
      const resp = await ai.chat({
        chatPrompt: [{ role: 'user', content: 'test' }],
        modelConfig: { stream: false },
      });

      const r = resp as Exclude<typeof resp, ReadableStream>;
      expect(r.results[0]?.content).toBe('fallback text');
    });

    it('returns error messages on failure', async () => {
      mockQuery.mockReturnValueOnce(
        mockQueryResult([
          resultMessage({
            subtype: 'error',
            is_error: true,
            errors: ['Something went wrong', 'Details here'],
          }),
        ]),
      );

      const ai = new AxAIClaudeAgentSDK();
      const resp = await ai.chat({
        chatPrompt: [{ role: 'user', content: 'fail' }],
        modelConfig: { stream: false },
      });

      const r = resp as Exclude<typeof resp, ReadableStream>;
      expect(r.results[0]?.content).toBe('Something went wrong\nDetails here');
    });

    it('returns empty string when no messages', async () => {
      mockQuery.mockReturnValueOnce(mockQueryResult([]));

      const ai = new AxAIClaudeAgentSDK();
      const resp = await ai.chat({
        chatPrompt: [{ role: 'user', content: 'empty' }],
        modelConfig: { stream: false },
      });

      const r = resp as Exclude<typeof resp, ReadableStream>;
      expect(r.results[0]?.content).toBe('');
    });
  });

  // ── Streaming chat ──────────────────────────────────────────────────────

  describe('streaming chat', () => {
    it('streams text deltas and returns usage on final chunk', async () => {
      mockQuery.mockReturnValueOnce(
        mockQueryResult([
          assistantMessage('Hello'),
          assistantMessage(' world'),
          resultMessage({
            result: 'Hello world',
            usage: {
              input_tokens: 200,
              output_tokens: 80,
              cache_creation_input_tokens: 5,
              cache_read_input_tokens: 15,
            },
          }),
        ]),
      );

      const ai = new AxAIClaudeAgentSDK();
      const resp = await ai.chat({
        chatPrompt: [{ role: 'user', content: 'stream test' }],
        modelConfig: { stream: true },
      });

      expect(resp).toBeInstanceOf(ReadableStream);
      const chunks = await drainStream(resp as ReadableStream<AxChatResponse>);

      // Should have text deltas + final result chunk
      expect(chunks.length).toBeGreaterThanOrEqual(2);

      // Text chunks
      const textChunks = chunks.filter(
        (c) =>
          c.results[0]?.content !== undefined &&
          c.results[0].content.length > 0,
      );
      expect(textChunks.length).toBeGreaterThanOrEqual(1);

      // Final chunk has usage
      const finalChunk = chunks.find((c) => c.modelUsage !== undefined);
      expect(finalChunk).toBeDefined();
      expect(finalChunk!.modelUsage?.tokens?.promptTokens).toBe(200);
      expect(finalChunk!.modelUsage?.tokens?.completionTokens).toBe(80);
      expect(finalChunk!.modelUsage?.tokens?.totalTokens).toBe(280);
      expect(finalChunk!.modelUsage?.tokens?.cacheCreationTokens).toBe(5);
      expect(finalChunk!.modelUsage?.tokens?.cacheReadTokens).toBe(15);
    });

    it('handles empty stream gracefully', async () => {
      mockQuery.mockReturnValueOnce(mockQueryResult([]));

      const ai = new AxAIClaudeAgentSDK();
      const resp = await ai.chat({
        chatPrompt: [{ role: 'user', content: 'empty stream' }],
        modelConfig: { stream: true },
      });

      expect(resp).toBeInstanceOf(ReadableStream);
      const chunks = await drainStream(resp as ReadableStream<AxChatResponse>);
      expect(chunks).toHaveLength(0);
    });
  });

  // ── Metrics tracking ───────────────────────────────────────────────────

  describe('metrics', () => {
    it('tracks latency after chat call', async () => {
      mockQuery.mockReturnValueOnce(
        mockQueryResult([resultMessage({ result: 'ok' })]),
      );

      const ai = new AxAIClaudeAgentSDK();
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

    it('tracks errors on query failure', async () => {
      const iter = mockQueryResult([]);
      mockQuery.mockReturnValueOnce({
        close: iter.close.bind(iter),
        [Symbol.asyncIterator]() {
          return {
            next(): Promise<IteratorResult<SDKMessage>> {
              return Promise.reject(new Error('SDK connection failed'));
            },
          };
        },
      });

      const ai = new AxAIClaudeAgentSDK();
      await expect(
        ai.chat({
          chatPrompt: [{ role: 'user', content: 'error test' }],
          modelConfig: { stream: false },
        }),
      ).rejects.toThrow();

      const metrics = ai.getMetrics();
      expect(metrics.errors.chat.total).toBe(1);
      expect(metrics.errors.chat.count).toBe(1);
      expect(metrics.errors.chat.rate).toBe(1);
    });

    it('accumulates metrics across multiple calls', async () => {
      mockQuery
        .mockReturnValueOnce(
          mockQueryResult([resultMessage({ result: 'first' })]),
        )
        .mockReturnValueOnce(
          mockQueryResult([resultMessage({ result: 'second' })]),
        );

      const ai = new AxAIClaudeAgentSDK();

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

  // ── Query options ──────────────────────────────────────────────────────

  describe('query options', () => {
    it('passes model to Agent SDK query', async () => {
      mockQuery.mockReturnValueOnce(
        mockQueryResult([resultMessage({ result: 'ok' })]),
      );

      const ai = new AxAIClaudeAgentSDK({ model: 'claude-haiku-4-5' });
      await ai.chat({
        chatPrompt: [{ role: 'user', content: 'model test' }],
        modelConfig: { stream: false },
      });

      expect(lastQueryCallArgs().options?.model).toBe('claude-haiku-4-5');
    });

    it('disables tools via empty array', async () => {
      mockQuery.mockReturnValueOnce(
        mockQueryResult([resultMessage({ result: 'ok' })]),
      );

      const ai = new AxAIClaudeAgentSDK();
      await ai.chat({
        chatPrompt: [{ role: 'user', content: 'tools test' }],
        modelConfig: { stream: false },
      });

      expect(lastQueryCallArgs().options?.tools).toEqual([]);
    });

    it('sets maxTurns from constructor option', async () => {
      mockQuery.mockReturnValueOnce(
        mockQueryResult([resultMessage({ result: 'ok' })]),
      );

      const ai = new AxAIClaudeAgentSDK({ maxTurns: 5 });
      await ai.chat({
        chatPrompt: [{ role: 'user', content: 'turns test' }],
        modelConfig: { stream: false },
      });

      expect(lastQueryCallArgs().options?.maxTurns).toBe(5);
    });

    it('passes cwd through to the Agent SDK', async () => {
      mockQuery.mockReturnValueOnce(
        mockQueryResult([resultMessage({ result: 'ok' })]),
      );

      const ai = new AxAIClaudeAgentSDK({ cwd: '/tmp/claude-eval' });
      await ai.chat({
        chatPrompt: [{ role: 'user', content: 'cwd test' }],
        modelConfig: { stream: false },
      });

      expect(lastQueryCallArgs().options?.cwd).toBe('/tmp/claude-eval');
    });

    it('passes explicit tool config to the Agent SDK', async () => {
      mockQuery.mockReturnValueOnce(
        mockQueryResult([resultMessage({ result: 'ok' })]),
      );

      const ai = new AxAIClaudeAgentSDK({
        tools: { type: 'preset', preset: 'claude_code' },
      });
      await ai.chat({
        chatPrompt: [{ role: 'user', content: 'preset test' }],
        modelConfig: { stream: false },
      });

      expect(lastQueryCallArgs().options?.tools).toEqual({
        type: 'preset',
        preset: 'claude_code',
      });
    });

    it('passes MCP servers to the Agent SDK', async () => {
      mockQuery.mockReturnValueOnce(
        mockQueryResult([resultMessage({ result: 'ok' })]),
      );

      const ai = new AxAIClaudeAgentSDK({
        mcpServers: {
          local: {
            command: 'node',
            args: ['server.js'],
          } satisfies McpServerConfig,
        },
      });
      await ai.chat({
        chatPrompt: [{ role: 'user', content: 'mcp test' }],
        modelConfig: { stream: false },
      });

      expect(lastQueryCallArgs().options?.mcpServers).toEqual({
        local: {
          command: 'node',
          args: ['server.js'],
        },
      });
    });

    it('merges extra env vars into the Agent SDK env', async () => {
      mockQuery.mockReturnValueOnce(
        mockQueryResult([resultMessage({ result: 'ok' })]),
      );

      const ai = new AxAIClaudeAgentSDK({
        extraEnv: { FOO: 'bar' },
      });
      await ai.chat({
        chatPrompt: [{ role: 'user', content: 'env test' }],
        modelConfig: { stream: false },
      });

      expect(lastQueryCallArgs().options?.env?.FOO).toBe('bar');
    });

    it('sets bypassPermissions mode', async () => {
      mockQuery.mockReturnValueOnce(
        mockQueryResult([resultMessage({ result: 'ok' })]),
      );

      const ai = new AxAIClaudeAgentSDK();
      await ai.chat({
        chatPrompt: [{ role: 'user', content: 'perms test' }],
        modelConfig: { stream: false },
      });

      expect(lastQueryCallArgs().options?.permissionMode).toBe(
        'bypassPermissions',
      );
    });
  });

  // ── Token usage tracking ───────────────────────────────────────────────

  describe('token usage', () => {
    it('maps cache tokens correctly', async () => {
      mockQuery.mockReturnValueOnce(
        mockQueryResult([
          resultMessage({
            usage: {
              input_tokens: 500,
              output_tokens: 200,
              cache_creation_input_tokens: 50,
              cache_read_input_tokens: 100,
            },
          }),
        ]),
      );

      const ai = new AxAIClaudeAgentSDK();
      const resp = await ai.chat({
        chatPrompt: [{ role: 'user', content: 'cache test' }],
        modelConfig: { stream: false },
      });

      const r = resp as Exclude<typeof resp, ReadableStream>;
      expect(r.modelUsage?.tokens?.cacheCreationTokens).toBe(50);
      expect(r.modelUsage?.tokens?.cacheReadTokens).toBe(100);
    });

    it('handles missing usage gracefully', async () => {
      mockQuery.mockReturnValueOnce(
        mockQueryResult([
          resultMessage({
            usage: undefined,
          }),
        ]),
      );

      const ai = new AxAIClaudeAgentSDK();
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
