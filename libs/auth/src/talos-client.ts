/**
 * Server-side Ory Talos client factory.
 *
 * The Talos admin API must only be reachable from trusted MoltNet services.
 * Browser and agent runtimes must never receive this configured client or its
 * access token.
 */

import { ApiKeysApi, Configuration } from '@ory/client-fetch';

export interface TalosClientConfig {
  baseUrl: string;
  apiKey?: string;
}

export function createTalosClient(config: TalosClientConfig): ApiKeysApi {
  return new ApiKeysApi(
    new Configuration({
      basePath: config.baseUrl,
      ...(config.apiKey ? { accessToken: config.apiKey } : {}),
    }),
  );
}
