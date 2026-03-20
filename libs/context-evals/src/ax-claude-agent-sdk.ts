/**
 * ax-claude-agent-sdk.ts — AxAIService adapter for the Claude Agent SDK
 *
 * Wraps `@anthropic-ai/claude-agent-sdk` as an AxAI-compatible service so
 * that GEPA can use Claude via keychain authentication (no ANTHROPIC_API_KEY
 * required).  The Agent SDK spawns a Claude Code subprocess per query; this
 * adapter disables tools and limits to a single turn so it behaves like a
 * standard chat-completions endpoint.
 *
 * All AxBaseAI metrics (OTel spans, token counters, latency p95/p99, error
 * rates) come for free because we extend AxBaseAI and route requests through
 * its `localCall` escape-hatch in `AxAPI`.
 */

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { query } from '@anthropic-ai/claude-agent-sdk';
import {
  type AxAIServiceImpl,
  type AxAIServiceOptions,
  type AxAPI,
  AxBaseAI,
  axBaseAIDefaultConfig,
  type AxChatResponse,
  type AxInternalChatRequest,
  type AxModelConfig,
  type AxModelInfo,
  type AxTokenUsage,
} from '@ax-llm/ax';

import { AGENT_FEATURES, flattenChatPrompt } from './ax-shared.js';
import { getRuntimeEnv, loadContextEvalsConfig } from './config.js';
import type { ResultPayload } from './sdk-types.js';

// ── Debug timing ─────────────────────────────────────────────────────────────

const DEBUG = getRuntimeEnv().AX_AGENT_SDK_DEBUG === '1';

function dbg(msg: string): void {
  if (DEBUG) process.stderr.write(`[ax-agent-sdk] ${msg}\n`);
}

// ── Types ────────────────────────────────────────────────────────────────────

type AgentModel = string;

interface AgentRequest {
  prompt: string;
  model: AgentModel;
}

interface AgentResponse {
  resultText: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
  };
  numTurns?: number;
  durationMs?: number;
  durationApiMs?: number;
  costUsd?: number;
}

/** Delta emitted during streaming — either a text chunk or the final result. */
interface AgentStreamDelta {
  type: 'text_delta' | 'result';
  text?: string;
  usage?: AgentResponse['usage'];
  numTurns?: number;
  durationMs?: number;
  durationApiMs?: number;
  costUsd?: number;
}

export interface AxAIClaudeAgentSDKOptions {
  model?: string;
  maxTurns?: number;
  options?: AxAIServiceOptions;
}

// ── Impl ─────────────────────────────────────────────────────────────────────

class AxAIClaudeAgentSDKImpl implements AxAIServiceImpl<
  AgentModel,
  never,
  AgentRequest,
  never,
  AgentResponse,
  AgentStreamDelta,
  never
> {
  private lastTokenUsage: AxTokenUsage | undefined;
  private maxTurns: number;
  /** Set to true when the current request expects a JSON-only response */
  expectsJsonResponse = false;

  constructor(maxTurns: number) {
    this.maxTurns = maxTurns;
  }

  // ── Request ──────────────────────────────────────────────────────────────

  createChatReq(
    req: Readonly<AxInternalChatRequest<AgentModel>>,
  ): [AxAPI, AgentRequest] {
    let prompt = flattenChatPrompt(req.chatPrompt);
    const model = req.model ?? 'claude-sonnet-4-6';
    const maxTurns = this.maxTurns;
    const stream = req.modelConfig?.stream ?? false;

    // When ax() uses structured output (f() API with complex fields),
    // it sends responseFormat with a JSON schema. Since the Claude Agent
    // SDK takes a plain text prompt, we inject the schema as instructions.
    if (
      req.responseFormat?.type === 'json_schema' &&
      req.responseFormat.schema
    ) {
      const rawSchema = req.responseFormat.schema as Record<string, unknown>;
      const schema =
        typeof rawSchema === 'object' && 'schema' in rawSchema
          ? rawSchema.schema
          : rawSchema;
      prompt +=
        '\n\nIMPORTANT: You MUST respond with ONLY a valid JSON object ' +
        'matching this schema. No markdown, no explanation, no wrapping:\n' +
        JSON.stringify(schema, null, 2);
      this.expectsJsonResponse = true;
    } else {
      this.expectsJsonResponse = false;
    }

    const localCall = async (
      data: AgentRequest,
    ): Promise<AgentResponse | ReadableStream<AgentStreamDelta>> => {
      if (stream) {
        return runAgentQueryStream(data.prompt, data.model, maxTurns);
      }
      return runAgentQuery(data.prompt, data.model, maxTurns);
    };

    const api: AxAPI = {
      name: 'claude-agent-sdk',
      localCall: localCall as AxAPI['localCall'],
    };

    return [api, { prompt, model }];
  }

  // ── Response (non-streaming) ──────────────────────────────────────────────

  createChatResp(resp: Readonly<AgentResponse>): AxChatResponse {
    const tokens = toTokenUsage(resp.usage);
    this.lastTokenUsage = tokens;

    // When structured output was requested, try to parse the response as
    // JSON. ax() expects the raw JSON object as the result content —
    // it will extract fields from it using its own parser.
    if (this.expectsJsonResponse) {
      const json = extractJsonFromText(resp.resultText);
      if (json !== null) {
        return {
          results: [
            {
              content: JSON.stringify(json),
              finishReason: 'stop' as const,
              index: 0,
            },
          ],
          modelUsage: {
            ai: 'claude-agent-sdk',
            model: 'claude-agent-sdk',
            tokens,
          },
        };
      }
    }

    return {
      results: [
        {
          content: resp.resultText,
          finishReason: 'stop' as const,
          index: 0,
        },
      ],
      modelUsage: {
        ai: 'claude-agent-sdk',
        model: 'claude-agent-sdk',
        tokens,
      },
    };
  }

  // ── Response (streaming) ──────────────────────────────────────────────────

  createChatStreamResp(
    delta: Readonly<AgentStreamDelta>,
    _state: object,
  ): AxChatResponse {
    if (delta.type === 'result' && delta.usage) {
      const tokens = toTokenUsage(delta.usage);
      this.lastTokenUsage = tokens;
      return {
        results: [{ content: '', finishReason: 'stop' as const, index: 0 }],
        modelUsage: {
          ai: 'claude-agent-sdk',
          model: 'claude-agent-sdk',
          tokens,
        },
      };
    }

    return {
      results: [{ content: delta.text ?? '', index: 0 }],
    };
  }

  // ── Config ───────────────────────────────────────────────────────────────

  getModelConfig(): AxModelConfig {
    return {
      ...axBaseAIDefaultConfig(),
      stream: false,
    };
  }

  getTokenUsage(): AxTokenUsage | undefined {
    return this.lastTokenUsage;
  }
}

// ── Public class ─────────────────────────────────────────────────────────────

const DEFAULT_MODEL = 'claude-sonnet-4-6';

const MODEL_INFO: AxModelInfo[] = [
  {
    name: 'claude-sonnet-4-6',
    promptTokenCostPer1M: 3,
    completionTokenCostPer1M: 15,
  },
  {
    name: 'claude-opus-4-6',
    promptTokenCostPer1M: 15,
    completionTokenCostPer1M: 75,
  },
  {
    name: 'claude-haiku-4-5',
    promptTokenCostPer1M: 0.8,
    completionTokenCostPer1M: 4,
  },
];

export class AxAIClaudeAgentSDK extends AxBaseAI<
  AgentModel,
  never,
  AgentRequest,
  never,
  AgentResponse,
  AgentStreamDelta,
  never,
  string
> {
  constructor(opts: AxAIClaudeAgentSDKOptions = {}) {
    const model = opts.model ?? DEFAULT_MODEL;
    const maxTurns = opts.maxTurns ?? 1;

    super(new AxAIClaudeAgentSDKImpl(maxTurns), {
      name: 'claude-agent-sdk',
      apiURL: '',
      headers: () => Promise.resolve({}),
      modelInfo: MODEL_INFO,
      defaults: { model },
      options: opts.options,
      supportFor: AGENT_FEATURES,
    });
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function toTokenUsage(usage: AgentResponse['usage']): AxTokenUsage {
  return {
    promptTokens: usage.inputTokens,
    completionTokens: usage.outputTokens,
    totalTokens: usage.inputTokens + usage.outputTokens,
    cacheReadTokens: usage.cacheReadInputTokens,
    cacheCreationTokens: usage.cacheCreationInputTokens,
  };
}

// ── Agent SDK query helpers ──────────────────────────────────────────────────

function buildQueryOptions(model: string, maxTurns: number) {
  const config = loadContextEvalsConfig();
  const runtimeEnv = getRuntimeEnv();

  return {
    model,
    ...(config.CLAUDE_CODE_EXECUTABLE
      ? { pathToClaudeCodeExecutable: config.CLAUDE_CODE_EXECUTABLE }
      : {}),
    permissionMode: 'bypassPermissions' as const,
    allowDangerouslySkipPermissions: true,
    tools: [] as string[],
    persistSession: false,
    includePartialMessages: false,
    maxTurns,
    debug: false,
    env: {
      ...runtimeEnv,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      ENABLE_TOOL_SEARCH: '0',
      ...(config.ANTHROPIC_API_KEY
        ? { ANTHROPIC_API_KEY: config.ANTHROPIC_API_KEY }
        : {}),
      ...(config.ANTHROPIC_AUTH_TOKEN
        ? { ANTHROPIC_AUTH_TOKEN: config.ANTHROPIC_AUTH_TOKEN }
        : {}),
    },
  };
}

interface AssistantContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
}

function getAssistantContent(message: SDKMessage): AssistantContentBlock[] {
  if (message.type !== 'assistant') return [];
  return (
    message as unknown as { message: { content: AssistantContentBlock[] } }
  ).message.content;
}

function extractAssistantText(message: SDKMessage): string | null {
  const content = getAssistantContent(message);
  const textBlocks = content.filter(
    (b): b is { type: 'text'; text: string } =>
      b.type === 'text' && typeof b.text === 'string',
  );
  return textBlocks.length > 0
    ? textBlocks.map((b) => b.text).join('\n')
    : null;
}

/**
 * Extract a JSON object from LLM text that may contain markdown fences
 * or surrounding prose.
 */
function extractJsonFromText(text: string): object | null {
  const trimmed = text.trim();

  // Case 1: raw JSON object
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      return JSON.parse(trimmed) as object;
    } catch {
      // not valid JSON
    }
  }

  // Case 2: markdown code block
  const codeBlock = trimmed.match(/```(?:json)?\s*\n([\s\S]+?)\n```/);
  if (codeBlock) {
    try {
      return JSON.parse(codeBlock[1]) as object;
    } catch {
      // not valid JSON inside code block
    }
  }

  // Case 3: JSON embedded in prose — find first { and last }
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(trimmed.slice(first, last + 1)) as object;
    } catch {
      // not valid JSON
    }
  }

  return null;
}

function buildAgentResponse(
  lastAssistantText: string,
  finalResult: ResultPayload | null,
): AgentResponse {
  let resultText: string;
  if (finalResult) {
    resultText =
      finalResult.subtype === 'success'
        ? (finalResult.result ?? lastAssistantText)
        : (finalResult.errors?.join('\n') ?? lastAssistantText);
  } else {
    resultText = lastAssistantText || '';
  }

  return {
    resultText,
    usage: {
      inputTokens: finalResult?.usage?.input_tokens ?? 0,
      outputTokens: finalResult?.usage?.output_tokens ?? 0,
      cacheCreationInputTokens: finalResult?.usage?.cache_creation_input_tokens,
      cacheReadInputTokens: finalResult?.usage?.cache_read_input_tokens,
    },
    numTurns: finalResult?.num_turns,
    durationMs: finalResult?.duration_ms,
    durationApiMs: finalResult?.duration_api_ms,
    costUsd: finalResult?.total_cost_usd,
  };
}

/** Non-streaming: collect all messages, return final AgentResponse. */
async function runAgentQuery(
  prompt: string,
  model: string,
  maxTurns: number,
): Promise<AgentResponse> {
  const t0 = performance.now();
  dbg(
    `query start model=${model} maxTurns=${maxTurns} prompt=${prompt.length}chars`,
  );

  const q = query({
    prompt,
    options: buildQueryOptions(model, maxTurns),
  }) as AsyncIterable<SDKMessage> & { close(): void };

  const tSpawn = performance.now();
  dbg(`query spawned in ${(tSpawn - t0).toFixed(0)}ms`);

  let lastAssistantText = '';
  let finalResult: ResultPayload | null = null;
  let messageCount = 0;
  let firstMessageAt: number | undefined;

  try {
    for await (const message of q) {
      messageCount++;
      if (!firstMessageAt) {
        firstMessageAt = performance.now();
        dbg(
          `first message in ${(firstMessageAt - tSpawn).toFixed(0)}ms (type=${message.type})`,
        );
      }
      const text = extractAssistantText(message);
      if (text !== null) {
        lastAssistantText = text;
      } else if (message.type === 'result') {
        finalResult = message as unknown as ResultPayload;
      }
    }
  } finally {
    q.close();
  }

  const total = performance.now() - t0;
  const resp = buildAgentResponse(lastAssistantText, finalResult);
  dbg(
    `query done in ${(total / 1000).toFixed(1)}s — ` +
      `messages=${messageCount} ` +
      `tokens=${resp.usage.inputTokens}in/${resp.usage.outputTokens}out ` +
      `result=${resp.resultText.length}chars`,
  );

  return resp;
}

/** Streaming: emit text deltas as SDKMessage events arrive. */
function runAgentQueryStream(
  prompt: string,
  model: string,
  maxTurns: number,
): ReadableStream<AgentStreamDelta> {
  return new ReadableStream<AgentStreamDelta>({
    async start(controller) {
      const q = query({
        prompt,
        options: {
          ...buildQueryOptions(model, maxTurns),
          includePartialMessages: true,
        },
      }) as AsyncIterable<SDKMessage> & { close(): void };

      try {
        for await (const message of q) {
          const text = extractAssistantText(message);
          if (text !== null) {
            controller.enqueue({ type: 'text_delta', text });
          } else if (message.type === 'result') {
            const result = message as unknown as ResultPayload;
            controller.enqueue({
              type: 'result',
              usage: {
                inputTokens: result.usage?.input_tokens ?? 0,
                outputTokens: result.usage?.output_tokens ?? 0,
                cacheCreationInputTokens:
                  result.usage?.cache_creation_input_tokens,
                cacheReadInputTokens: result.usage?.cache_read_input_tokens,
              },
              numTurns: result.num_turns,
              durationMs: result.duration_ms,
              durationApiMs: result.duration_api_ms,
              costUsd: result.total_cost_usd,
            });
          }
        }
      } catch (err) {
        controller.error(err);
        return;
      } finally {
        q.close();
      }
      controller.close();
    },
  });
}
