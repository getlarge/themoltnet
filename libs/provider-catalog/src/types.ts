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
