/**
 * ax-codex-agent-sdk.ts — AxAIService adapter for the Codex TypeScript SDK
 *
 * Wraps `@openai/codex-sdk` as an AxAI-compatible service so GEPA and other
 * Ax-based pipelines can use the local Codex agent with the same interface as
 * the Claude adapter.
 */

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
import {
  type AgentMessageItem,
  Codex,
  type ThreadOptions,
  type Usage,
} from '@openai/codex-sdk';

import {
  AGENT_FEATURES,
  extractJsonFromText,
  flattenChatPrompt,
} from './ax-shared.js';
import { getRuntimeEnv, loadAxAgentsConfig } from './config.js';

const DEBUG = getRuntimeEnv().AX_AGENT_SDK_DEBUG === '1';

function dbg(msg: string): void {
  if (DEBUG) process.stderr.write(`[ax-codex-agent-sdk] ${msg}\n`);
}

type AgentModel = string;

interface AgentRequest {
  prompt: string;
  model: AgentModel;
  /** JSON schema for structured output (passed to Codex outputSchema) */
  outputSchema?: unknown;
}

interface AgentResponse {
  resultText: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens?: number;
  };
}

interface AgentStreamDelta {
  type: 'text_delta' | 'result';
  text?: string;
  usage?: AgentResponse['usage'];
}

export interface AxAICodexAgentSDKOptions {
  model?: string;
  maxTurns?: number;
  options?: AxAIServiceOptions;
  cwd?: string;
  sandboxMode?: 'read-only' | 'full';
  extraEnv?: Record<string, string>;
}

class AxAICodexAgentSDKImpl implements AxAIServiceImpl<
  AgentModel,
  never,
  AgentRequest,
  never,
  AgentResponse,
  AgentStreamDelta,
  never
> {
  private lastTokenUsage: AxTokenUsage | undefined;
  private opts: AxAICodexAgentSDKOptions;

  constructor(opts: AxAICodexAgentSDKOptions) {
    this.opts = opts;
  }

  createChatReq(
    req: Readonly<AxInternalChatRequest<AgentModel>>,
  ): [AxAPI, AgentRequest] {
    const prompt = flattenChatPrompt(req.chatPrompt);
    const model = req.model ?? DEFAULT_MODEL;
    const stream = req.modelConfig?.stream ?? false;

    // When ax() uses structured output, extract the JSON schema to pass
    // to Codex's native outputSchema on TurnOptions.
    let outputSchema: unknown;
    if (
      req.responseFormat?.type === 'json_schema' &&
      req.responseFormat.schema
    ) {
      const rawSchema = req.responseFormat.schema as Record<string, unknown>;
      outputSchema =
        typeof rawSchema === 'object' && 'schema' in rawSchema
          ? rawSchema.schema
          : rawSchema;
    }

    const sdkOpts = this.opts;
    const localCall = async (
      data: AgentRequest,
    ): Promise<AgentResponse | ReadableStream<AgentStreamDelta>> => {
      if (stream) {
        return runAgentQueryStream(data.prompt, data.model, sdkOpts);
      }
      return runAgentQuery(data.prompt, data.model, sdkOpts, data.outputSchema);
    };

    const api: AxAPI = {
      name: 'codex-agent-sdk',
      localCall: localCall as AxAPI['localCall'],
    };

    return [api, { prompt, model, outputSchema }];
  }

  createChatResp(resp: Readonly<AgentResponse>): AxChatResponse {
    const tokens = toTokenUsage(resp.usage);
    this.lastTokenUsage = tokens;

    // Try to parse as JSON — Codex with outputSchema returns valid JSON.
    // Stateless (no mutable flag) so safe under concurrency.
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
          ai: 'codex-agent-sdk',
          model: 'codex-agent-sdk',
          tokens,
        },
      };
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
        ai: 'codex-agent-sdk',
        model: 'codex-agent-sdk',
        tokens,
      },
    };
  }

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
          ai: 'codex-agent-sdk',
          model: 'codex-agent-sdk',
          tokens,
        },
      };
    }

    return {
      results: [{ content: delta.text ?? '', index: 0 }],
    };
  }

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

const DEFAULT_MODEL = 'gpt-5-codex';

const MODEL_INFO: AxModelInfo[] = [
  { name: 'gpt-5-codex' },
  { name: 'gpt-5-codex-mini' },
];

export class AxAICodexAgentSDK extends AxBaseAI<
  AgentModel,
  never,
  AgentRequest,
  never,
  AgentResponse,
  AgentStreamDelta,
  never,
  string
> {
  constructor(opts: AxAICodexAgentSDKOptions = {}) {
    const model = opts.model ?? DEFAULT_MODEL;

    super(new AxAICodexAgentSDKImpl(opts), {
      name: 'codex-agent-sdk',
      apiURL: '',
      headers: () => Promise.resolve({}),
      modelInfo: MODEL_INFO,
      defaults: { model },
      options: opts.options,
      supportFor: AGENT_FEATURES,
    });
  }
}

function toTokenUsage(usage: AgentResponse['usage']): AxTokenUsage {
  return {
    promptTokens: usage.inputTokens,
    completionTokens: usage.outputTokens,
    totalTokens: usage.inputTokens + usage.outputTokens,
    cacheReadTokens: usage.cachedInputTokens,
  };
}

function buildInstructionPrompt(
  prompt: string,
  opts: AxAICodexAgentSDKOptions,
): string {
  const maxTurns = opts.maxTurns ?? 1;
  return [
    'You are being used as a single-response model adapter.',
    `Limit yourself to ${maxTurns} internal turn(s) if possible.`,
    'Do not ask follow-up questions.',
    'Return only the final answer.',
    '',
    prompt,
  ].join('\n');
}

function buildThreadOptions(
  model: string,
  opts: AxAICodexAgentSDKOptions,
): ThreadOptions {
  return {
    model,
    sandboxMode:
      (opts.sandboxMode as ThreadOptions['sandboxMode']) ?? 'read-only',
    skipGitRepoCheck: true,
    approvalPolicy: 'never',
    modelReasoningEffort: 'low',
    networkAccessEnabled: false,
    ...(opts.cwd ? { cwd: opts.cwd } : {}),
  };
}

function buildCodex(opts: AxAICodexAgentSDKOptions): Codex {
  const config = loadAxAgentsConfig();
  const env = buildCodexEnv(opts);

  return new Codex({
    ...(config.CODEX_EXECUTABLE
      ? { codexPathOverride: config.CODEX_EXECUTABLE }
      : {}),
    ...(config.OPENAI_API_KEY ? { apiKey: config.OPENAI_API_KEY } : {}),
    env,
  });
}

function buildCodexEnv(opts: AxAICodexAgentSDKOptions): Record<string, string> {
  const config = loadAxAgentsConfig();
  const runtimeEnv = getRuntimeEnv();
  const env: Record<string, string> = {
    OTEL_SDK_DISABLED: 'true',
    OPENAI_DISABLE_TELEMETRY: '1',
    PATH: runtimeEnv.PATH || '',
    ...opts.extraEnv,
  };

  if (config.OPENAI_API_KEY) {
    env.OPENAI_API_KEY = config.OPENAI_API_KEY;
  }

  return env;
}

async function runAgentQuery(
  prompt: string,
  model: string,
  opts: AxAICodexAgentSDKOptions,
  outputSchema?: unknown,
): Promise<AgentResponse> {
  dbg(`run model=${model} prompt=${prompt.length}chars`);
  const thread = buildCodex(opts).startThread(buildThreadOptions(model, opts));
  const turn = await thread.run(buildInstructionPrompt(prompt, opts), {
    ...(outputSchema ? { outputSchema } : {}),
  });

  return {
    resultText:
      turn.finalResponse || extractLastAgentMessageText(turn.items) || '',
    usage: mapUsage(turn.usage),
  };
}

function runAgentQueryStream(
  prompt: string,
  model: string,
  opts: AxAICodexAgentSDKOptions,
): ReadableStream<AgentStreamDelta> {
  return new ReadableStream<AgentStreamDelta>({
    async start(controller) {
      try {
        const thread = buildCodex(opts).startThread(
          buildThreadOptions(model, opts),
        );
        const { events } = await thread.runStreamed(
          buildInstructionPrompt(prompt, opts),
        );

        for await (const event of events) {
          if (
            event.type === 'item.completed' &&
            event.item.type === 'agent_message'
          ) {
            controller.enqueue({ type: 'text_delta', text: event.item.text });
          } else if (event.type === 'turn.completed') {
            controller.enqueue({
              type: 'result',
              usage: mapUsage(event.usage),
            });
          } else if (event.type === 'turn.failed') {
            controller.error(new Error(event.error.message));
            return;
          } else if (event.type === 'error') {
            controller.error(new Error(event.message));
            return;
          }
        }

        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

function mapUsage(usage: Usage | null): AgentResponse['usage'] {
  return {
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    cachedInputTokens: usage?.cached_input_tokens,
  };
}

function extractLastAgentMessageText(items: { type: string }[]): string | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item?.type === 'agent_message') {
      return (item as AgentMessageItem).text;
    }
  }
  return null;
}
