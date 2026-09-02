import { join } from 'node:path';

import type { Api, Model } from '@earendil-works/pi-ai';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';

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
  const modelRuntime = await ModelRuntime.create({
    authPath: join(piAuthDir, 'auth.json'),
    modelsPath,
  });
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
