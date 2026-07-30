import { join } from 'node:path';

import type { Api, Model } from '@earendil-works/pi-ai';
import { AuthStorage, ModelRegistry } from '@earendil-works/pi-coding-agent';

export interface RuntimeModelSelection {
  modelHandle: Model<Api>;
  modelRegistry: ModelRegistry;
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
export function resolveRuntimeProfileModel(
  piAuthDir: string,
  provider: string,
  modelId: string,
  runtimeProfileId?: string,
): RuntimeModelSelection {
  const authStorage = AuthStorage.create(join(piAuthDir, 'auth.json'));
  const modelsPath = join(piAuthDir, 'models.json');
  const modelRegistry = ModelRegistry.create(authStorage, modelsPath);
  const modelHandle = modelRegistry.find(provider, modelId);

  if (!modelHandle) {
    const registryError = modelRegistry.getError();
    const detail = registryError ? ` Registry error: ${registryError}` : '';
    const alternatives = modelRegistry
      .getAvailable()
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

  return { modelHandle, modelRegistry };
}
