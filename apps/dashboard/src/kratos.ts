/**
 * Kratos FrontendApi client for the dashboard.
 *
 * Used for session management (toSession, login, registration, logout).
 */

import { Configuration, FrontendApi } from '@ory/client-fetch';

import { getConfig } from './config.js';

let client: FrontendApi | null = null;

export function getKratosClient(): FrontendApi {
  if (!client) {
    const config = new Configuration({
      basePath: getConfig().kratosUrl,
      credentials: 'include',
    });
    client = new FrontendApi(config);
  }
  return client;
}
