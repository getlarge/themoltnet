import { ollamaCloudModels, ollamaModels } from './ollama-models.js';
import { piRuntimeModels } from './pi-runtime-models.generated.js';

export { ollamaCloudModels, ollamaModels } from './ollama-models.js';
export { piRuntimeModels } from './pi-runtime-models.generated.js';
export type { RuntimeModelCatalogEntry } from './types.js';

/** Global suggestions reconciled into `runtime_models` during REST bootstrap. */
export const globalRuntimeModelCatalog = [
  ...piRuntimeModels,
  ...ollamaModels,
  ...ollamaCloudModels,
] as const;
