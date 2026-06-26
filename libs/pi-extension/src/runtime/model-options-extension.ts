import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

export interface PiModelOptions {
  temperature?: number | null;
  topP?: number | null;
  topK?: number | null;
  maxOutputTokens?: number | null;
}

export function hasPiModelOptions(options: PiModelOptions): boolean {
  return (
    (options.temperature !== undefined && options.temperature !== null) ||
    (options.topP !== undefined && options.topP !== null) ||
    (options.topK !== undefined && options.topK !== null) ||
    (options.maxOutputTokens !== undefined && options.maxOutputTokens !== null)
  );
}

export function createPiModelOptionsExtension(options: PiModelOptions) {
  return function piModelOptionsExtension(pi: ExtensionAPI): void {
    pi.on('before_provider_request', (event) => {
      return applyPiModelOptions(event.payload, options);
    });
  };
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
    isRecord(payload.thinking) ||
    'reasoning' in payload ||
    'reasoning_effort' in payload;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
