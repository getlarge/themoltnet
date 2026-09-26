import { ollamaCloudModels, ollamaModels } from './ollama-models.js';
import { piRuntimeModels } from './pi-runtime-models.generated.js';
import { type RequestOptionName, requestOptionNames } from './types.js';

const capabilityNames: Record<RequestOptionName, string> = {
  temperature: 'supportsTemperature',
  topP: 'supportsTopP',
  topK: 'supportsTopK',
  maxOutputTokens: 'supportsMaxOutputTokens',
};
const catalogEntries = [
  ...piRuntimeModels,
  ...ollamaModels,
  ...ollamaCloudModels,
];

/** Undefined means the catalog cannot decide; the provider error classifier remains the backstop. */
export function requestOptionCapabilities(
  provider: string,
  model: string,
): Partial<Record<RequestOptionName, boolean>> {
  const normalizedProvider = provider.toLowerCase();
  // Codex's subscription endpoint rejects these profile overrides regardless
  // of model. This also covers models newer than the pinned Pi snapshot.
  if (normalizedProvider === 'openai-codex') {
    return Object.fromEntries(requestOptionNames.map((name) => [name, false]));
  }

  const entry = catalogEntries.find(
    (candidate) =>
      candidate.provider === normalizedProvider &&
      candidate.model === model.toLowerCase(),
  );
  if (!entry) return {};

  return Object.fromEntries(
    requestOptionNames.flatMap((name) => {
      const value = entry.capabilities[capabilityNames[name]];
      return typeof value === 'boolean' ? [[name, value]] : [];
    }),
  );
}

export function getUnsupportedRequestOptions(
  provider: string,
  model: string,
  options: Partial<Record<RequestOptionName, number | null>>,
): RequestOptionName[] {
  const capabilities = requestOptionCapabilities(provider, model);
  return requestOptionNames.filter(
    (name) =>
      options[name] !== null &&
      options[name] !== undefined &&
      capabilities[name] === false,
  );
}
