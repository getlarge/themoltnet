import { ollamaCloudModelIds } from './ollama-cloud-models.generated.js';
import type { RuntimeModelCatalogEntry } from './types.js';

// MoltNet's Pi integration uses Ollama's OpenAI-compatible endpoint. That
// route accepts temperature, top_p, and output caps, but does not expose the
// native Ollama top_k option through Pi's openai-completions request shape.
// https://docs.ollama.com/api/openai-compatibility
const openAiCompatibleRequestCapabilities = {
  supportsTemperature: true,
  supportsTopP: true,
  supportsTopK: false,
  supportsMaxOutputTokens: true,
} as const;

/**
 * Reviewed suggestions from Ollama's public Model Library (2026-09-04).
 * These describe model names that a user may choose; they do not assert that
 * a model is installed in any local Ollama runtime.
 */
export const ollamaModels: readonly RuntimeModelCatalogEntry[] = [
  'deepseek-r1',
  'gemma3',
  'gemma3:12b',
  'llama3.3',
  'llama4',
  'mistral-small3.1',
  'phi4',
  'qwen2.5-coder',
  'qwen3',
  'qwen3-coder',
].map((model) => ({
  provider: 'ollama',
  model,
  displayName: `Ollama · ${model}`,
  description: 'Local Ollama model suggestion; installation is not implied.',
  capabilities: { ...openAiCompatibleRequestCapabilities },
}));

/**
 * Ollama Cloud entries generated from the public model list at
 * https://ollama.com/v1/models (see `generate:ollama-cloud`). Ids are the ones
 * the `ollama-cloud` provider accepts, without local-proxy `:cloud` aliases.
 */
export const ollamaCloudModels: readonly RuntimeModelCatalogEntry[] =
  ollamaCloudModelIds.map((model) => ({
    provider: 'ollama-cloud',
    model,
    displayName: `Ollama Cloud · ${model}`,
    description: 'Ollama Cloud model suggestion.',
    capabilities: { ...openAiCompatibleRequestCapabilities },
  }));
