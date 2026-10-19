import {
  ollamaClassifierModels,
  ollamaCloudModels,
  ollamaModels,
} from './ollama-models.js';
import { piRuntimeModels } from './pi-runtime-models.generated.js';

export { ollamaCloudModelData } from './ollama-cloud-models.generated.js';
export {
  ollamaClassifierModels,
  ollamaCloudModels,
  ollamaModels,
} from './ollama-models.js';
export { piRuntimeModels } from './pi-runtime-models.generated.js';
export {
  getUnsupportedRequestOptions,
  requestOptionCapabilities,
} from './request-options.js';
export type { RuntimeModelCatalogEntry } from './types.js';
export type { ModelCostRates } from './types.js';
export type { RequestOptionName } from './types.js';

/** Global suggestions reconciled into `runtime_models` during REST bootstrap. */
export const globalRuntimeModelCatalog = [
  ...piRuntimeModels,
  ...ollamaModels,
  ...ollamaClassifierModels,
  ...ollamaCloudModels,
] as const;
