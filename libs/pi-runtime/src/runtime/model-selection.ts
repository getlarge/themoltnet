import { join } from 'node:path';

import type { Api, Model } from '@earendil-works/pi-ai';
import { AuthStorage, ModelRegistry } from '@earendil-works/pi-coding-agent';

export interface RuntimeModelSelection {
  modelHandle: Model<Api>;
  modelRegistry: ModelRegistry;
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
): RuntimeModelSelection {
  const authStorage = AuthStorage.create(join(piAuthDir, 'auth.json'));
  const modelsPath = join(piAuthDir, 'models.json');
  const modelRegistry = ModelRegistry.create(authStorage, modelsPath);
  const modelHandle = modelRegistry.find(provider, modelId);

  if (!modelHandle) {
    const registryError = modelRegistry.getError();
    const detail = registryError ? ` Registry error: ${registryError}` : '';
    throw new Error(
      `Runtime profile model "${provider}/${modelId}" is unavailable in ` +
        `${modelsPath}; refusing Pi default-model fallback.${detail}`,
    );
  }

  return { modelHandle, modelRegistry };
}
