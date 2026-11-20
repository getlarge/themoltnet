import { join } from 'node:path';

import type { Api, Model } from '@earendil-works/pi-ai';
import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { ollamaCloudModelData } from '@moltnet/provider-catalog';

import { createRuntimeModels } from './model-runtime.js';
import type { PiThinkingLevel } from './pi-thinking-level.js';

/** Reject known Ollama Cloud controls that sparse declarations would silently omit. */
export function assertRuntimeProfileThinkingLevel(
  model: Model<Api>,
  level?: PiThinkingLevel | null,
): void {
  if (level === undefined || level === null) return;
  if (model.api !== 'openai-completions') return;
  let endpoint: URL;
  try {
    endpoint = new URL(model.baseUrl);
  } catch {
    return;
  }
  if (
    endpoint.origin !== 'https://ollama.com' ||
    endpoint.pathname.replace(/\/$/, '') !== '/v1'
  )
    return;
  const known = ollamaCloudModelData.find((item) => item.id === model.id);
  if (!known?.thinkingLevels?.some((value) => value !== 'off')) return;
  if (level !== 'off' && !model.reasoning)
    throw new RuntimeProfileModelResolutionError(
      `Model ${model.provider}/${model.id} is not declared thinking-capable; cannot honor profile thinkingLevel=${level}`,
    );
  if (
    level === 'off' &&
    known?.thinkingLevels?.includes('off') &&
    known.thinkingLevels.some((value) => value !== 'off') &&
    (!model.reasoning || model.thinkingLevelMap?.off !== 'none')
  )
    throw new RuntimeProfileModelResolutionError(
      `Model ${model.provider}/${model.id} supports thinking off, but its provider declaration cannot transmit it; declare reasoning support and thinkingLevelMap.off=none`,
    );
}

export interface RuntimeModelSelection {
  modelHandle: Model<Api>;
  modelRuntime: ModelRuntime;
}

export class RuntimeProfileModelResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuntimeProfileModelResolutionError';
  }
}

/**
 * Resolve the exact runtime-profile model through Pi's custom-model registry.
 *
 * `getModel()` from pi-ai only knows generated built-in models. Runtime
 * profiles commonly select providers declared in the active Pi directory's
 * models.json, so an unresolved lookup must fail closed rather than letting
 * createAgentSession silently choose the default from settings.json.
 */
export async function resolveRuntimeProfileModel(
  piAuthDir: string,
  provider: string,
  modelId: string,
  runtimeProfileId?: string,
): Promise<RuntimeModelSelection> {
  const modelsPath = join(piAuthDir, 'models.json');
  const modelRuntime = await createRuntimeModels(piAuthDir);
  const modelHandle = modelRuntime.getModel(provider, modelId);

  if (!modelHandle) {
    const registryError = modelRuntime.getError();
    const detail = registryError ? ` Registry error: ${registryError}` : '';
    const alternatives = modelRuntime
      .getModels()
      .slice(0, 8)
      .map((model) => `${model.provider}/${model.id}`);
    const profile = runtimeProfileId
      ? `Runtime profile "${runtimeProfileId}"`
      : 'Runtime profile';
    throw new RuntimeProfileModelResolutionError(
      `${profile} model "${provider}/${modelId}" was not found in ` +
        `${modelsPath}; refusing Pi default-model fallback.` +
        (alternatives.length > 0
          ? ` Available models include: ${alternatives.join(', ')}.`
          : '') +
        detail,
    );
  }

  return { modelHandle, modelRuntime };
}
