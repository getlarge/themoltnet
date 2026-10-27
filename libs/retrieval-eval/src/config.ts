export const weights = [
  { name: 'relevance', wRelevance: 1, wRecency: 0, wImportance: 0 },
  { name: 'recency', wRelevance: 1, wRecency: 0.2, wImportance: 0 },
  { name: 'importance', wRelevance: 1, wRecency: 0, wImportance: 0.2 },
  { name: 'combined', wRelevance: 1, wRecency: 0.2, wImportance: 0.2 },
] as const;
export const historicalDates: Record<string, string> = {
  fishing: '2024-01-01T00:00:00Z',
  angling: '2024-01-01T00:00:00Z',
  'ranking-incident': '2024-01-01T00:00:00Z',
  'search-ui-copy': '2025-01-01T00:00:00Z',
  'retrieval-tuning': '2025-06-01T00:00:00Z',
};
export const modelIdentity = {
  modelId: 'Xenova/e5-small-v2',
  quantization: 'q8',
  dimensions: 384,
} as const;
export const image = 'pgvector/pgvector:pg16';

export const environment = {
  modelCache: process.env.RETRIEVAL_MODEL_CACHE,
  workspace: process.env.RETRIEVAL_WORKSPACE,
};
