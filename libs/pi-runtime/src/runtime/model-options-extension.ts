import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { getUnsupportedRequestOptions } from '@moltnet/provider-catalog';

export interface PiModelOptions {
  temperature?: number | null;
  topP?: number | null;
  topK?: number | null;
  maxOutputTokens?: number | null;
}

function hasPiModelOptions(options: PiModelOptions): boolean {
  return (
    (options.temperature !== undefined && options.temperature !== null) ||
    (options.topP !== undefined && options.topP !== null) ||
    (options.topK !== undefined && options.topK !== null) ||
    (options.maxOutputTokens !== undefined && options.maxOutputTokens !== null)
  );
}

/** Apply the same provider payload policy to Durable requests and child conversations. */
export function configureDurableModelOptions(
  models: ModelRuntime,
  options: PiModelOptions,
  provider: string,
  model: string,
  warn: (details: Record<string, unknown>, message: string) => void,
  observe?: (options: Record<string, unknown>) => void | Promise<void>,
): void {
  if (!hasPiModelOptions(options) && !observe) return;
  const filtered = { ...options };
  for (const option of getUnsupportedRequestOptions(provider, model, options)) {
    delete filtered[option];
    warn(
      { option, provider, model },
      'Runtime profile model option is unsupported by the selected provider/model; omitting it',
    );
  }
  const stream = models.streamSimple.bind(models);
  const observed = new Set<string>();
  models.streamSimple = (selected, context, request) =>
    stream(selected, context, {
      ...request,
      onPayload: async (payload, selectedModel) => {
        const previous = await request?.onPayload?.(payload, selectedModel);
        const effective = previous ?? payload;
        let result = applyPiModelOptions(effective, filtered) ?? effective;
        // Also cover caller-supplied/legacy models.json that bypasses our writer.
        if (
          isRecord(result) &&
          typeof filtered.maxOutputTokens === 'number' &&
          selectedModel.api === 'openai-completions' &&
          isOllamaChatEndpoint(selectedModel.baseUrl)
        ) {
          result = { ...result, max_tokens: filtered.maxOutputTokens };
          delete (result as Record<string, unknown>).max_completion_tokens;
        }
        if (observe && isRecord(result)) {
          // Only scalar inference controls: never prompts, headers or credentials.
          const controls: Record<string, unknown> = {
            provider: selectedModel.provider,
            model: selectedModel.id,
          };
          for (const key of [
            'reasoning_effort',
            'temperature',
            'top_p',
            'max_tokens',
            'max_completion_tokens',
          ]) {
            const value = result[key];
            if (typeof value === 'string' || typeof value === 'number')
              controls[key] = value;
          }
          const digest = JSON.stringify(controls);
          if (!observed.has(digest)) {
            observed.add(digest);
            try {
              await observe(controls);
            } catch {
              warn(
                { provider: selectedModel.provider, model: selectedModel.id },
                'Unable to record provider request controls',
              );
            }
          }
        }
        return result;
      },
    });
}

function isOllamaChatEndpoint(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    return (
      url.origin === 'https://ollama.com' &&
      url.pathname.replace(/\/$/, '') === '/v1'
    );
  } catch {
    return false;
  }
}

export function applyPiModelOptions(
  payload: unknown,
  options: PiModelOptions,
): unknown | undefined {
  if (!isRecord(payload)) return undefined;
  if (!hasPiModelOptions(options)) return undefined;

  if (isGooglePayload(payload)) {
    const config = isRecord(payload.config) ? payload.config : {};
    return {
      ...payload,
      config: applyConfigOptions(config, options),
    };
  }

  if (isBedrockPayload(payload)) {
    const inferenceConfig = isRecord(payload.inferenceConfig)
      ? payload.inferenceConfig
      : {};
    return {
      ...payload,
      inferenceConfig: applyBedrockOptions(inferenceConfig, options),
    };
  }

  return applyTopLevelOptions(payload, options);
}

function applyConfigOptions(
  config: Record<string, unknown>,
  options: PiModelOptions,
): Record<string, unknown> {
  return {
    ...config,
    ...(options.temperature !== undefined && options.temperature !== null
      ? { temperature: options.temperature }
      : {}),
    ...(options.topP !== undefined && options.topP !== null
      ? { topP: options.topP }
      : {}),
    ...(options.topK !== undefined && options.topK !== null
      ? { topK: options.topK }
      : {}),
    ...(options.maxOutputTokens !== undefined &&
    options.maxOutputTokens !== null
      ? { maxOutputTokens: options.maxOutputTokens }
      : {}),
  };
}

function applyBedrockOptions(
  inferenceConfig: Record<string, unknown>,
  options: PiModelOptions,
): Record<string, unknown> {
  return {
    ...inferenceConfig,
    ...(options.temperature !== undefined && options.temperature !== null
      ? { temperature: options.temperature }
      : {}),
    ...(options.topP !== undefined && options.topP !== null
      ? { topP: options.topP }
      : {}),
    ...(options.maxOutputTokens !== undefined &&
    options.maxOutputTokens !== null
      ? { maxTokens: options.maxOutputTokens }
      : {}),
  };
}

function applyTopLevelOptions(
  payload: Record<string, unknown>,
  options: PiModelOptions,
): Record<string, unknown> {
  const reasoningEnabled =
    hasActiveThinking(payload.thinking) ||
    'reasoning' in payload ||
    ('reasoning_effort' in payload && payload.reasoning_effort !== 'none');
  const next: Record<string, unknown> = { ...payload };

  if (
    options.temperature !== undefined &&
    options.temperature !== null &&
    !reasoningEnabled
  ) {
    next.temperature = options.temperature;
  }
  if (
    options.topP !== undefined &&
    options.topP !== null &&
    !reasoningEnabled
  ) {
    next.top_p = options.topP;
  }
  if (
    options.topK !== undefined &&
    options.topK !== null &&
    !reasoningEnabled &&
    isAnthropicPayload(next)
  ) {
    next.top_k = options.topK;
  }
  if (
    options.maxOutputTokens !== undefined &&
    options.maxOutputTokens !== null
  ) {
    const maxOutputTokens = options.maxOutputTokens;
    if ('max_output_tokens' in next || isResponsesPayload(next)) {
      next.max_output_tokens = maxOutputTokens;
    } else if ('max_completion_tokens' in next) {
      next.max_completion_tokens = maxOutputTokens;
    } else if ('maxTokens' in next) {
      next.maxTokens = maxOutputTokens;
    } else {
      next.max_tokens = maxOutputTokens;
    }
  }

  return next;
}

function isGooglePayload(
  payload: Record<string, unknown>,
): payload is Record<string, unknown> & { config?: unknown } {
  return 'contents' in payload && ('config' in payload || 'model' in payload);
}

function isBedrockPayload(
  payload: Record<string, unknown>,
): payload is Record<string, unknown> & { inferenceConfig?: unknown } {
  return (
    'inferenceConfig' in payload || 'additionalModelRequestFields' in payload
  );
}

function isResponsesPayload(payload: Record<string, unknown>): boolean {
  return 'input' in payload && !('messages' in payload);
}

function isAnthropicPayload(payload: Record<string, unknown>): boolean {
  return 'anthropic_version' in payload;
}

function hasActiveThinking(value: unknown): boolean {
  if (!isRecord(value)) return false;

  const type = value.type;
  return type !== 'disabled' && type !== 'off' && type !== false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
