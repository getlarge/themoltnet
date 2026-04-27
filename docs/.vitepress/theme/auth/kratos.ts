import { Configuration, FrontendApi } from '@ory/client-fetch';

import { getAuthConfig } from './config';

let client: FrontendApi | null = null;

export function getKratosClient(): FrontendApi {
  if (!client) {
    client = new FrontendApi(
      new Configuration({
        basePath: getAuthConfig().kratosUrl,
        credentials: 'include',
      }),
    );
  }
  return client;
}
