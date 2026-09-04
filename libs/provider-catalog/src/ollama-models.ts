import type { RuntimeModelCatalogEntry } from './types.js';

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
  capabilities: {},
}));

/** Reviewed Ollama Cloud entries from the public Model Library (2026-09-04). */
export const ollamaCloudModels: readonly RuntimeModelCatalogEntry[] = [
  'deepseek-v3.1:671b-cloud',
  'deepseek-v4-flash:cloud',
  'deepseek-v4-pro:cloud',
  'gemma3:27b-cloud',
  'gemma4:cloud',
  'glm-5.1:cloud',
  'glm-5.2:cloud',
  'kimi-k2.5:cloud',
  'llama3.3:70b-cloud',
  'minimax-m2.5:cloud',
  'minimax-m3:cloud',
  'qwen3-coder:480b-cloud',
].map((model) => ({
  provider: 'ollama-cloud',
  model,
  displayName: `Ollama Cloud · ${model}`,
  description: 'Ollama Cloud model suggestion.',
  capabilities: {},
}));
