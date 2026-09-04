export type RuntimeModelCatalogEntry = {
  provider: string;
  model: string;
  displayName: string;
  description?: string;
  capabilities: Record<string, boolean | number | string>;
};
