/** USD per million tokens, using Pi's model price field names. */
export type ModelCostRates = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

export type RuntimeModelCatalogEntry = {
  provider: string;
  model: string;
  displayName: string;
  description?: string;
  capabilities: Record<string, boolean | number | string>;
};

export const requestOptionNames = [
  'temperature',
  'topP',
  'topK',
  'maxOutputTokens',
] as const;

export type RequestOptionName = (typeof requestOptionNames)[number];
