/**
 * @moltnet/auth — Ory SDK Client Factory
 *
 * Creates configured instances of all Ory API clients.
 */

import {
  Configuration,
  FrontendApi,
  IdentityApi,
  OAuth2Api,
  PermissionApi,
  RelationshipApi,
} from '@ory/client';

export interface OryClientConfig {
  baseUrl: string;
  apiKey?: string;
}

export interface OryClients {
  frontend: FrontendApi;
  identity: IdentityApi;
  oauth2: OAuth2Api;
  permission: PermissionApi;
  relationship: RelationshipApi;
}

export function createOryClients(config: OryClientConfig): OryClients {
  const configuration = new Configuration({
    basePath: config.baseUrl,
    ...(config.apiKey ? { accessToken: config.apiKey } : {}),
  });

  return {
    frontend: new FrontendApi(configuration),
    identity: new IdentityApi(configuration),
    oauth2: new OAuth2Api(configuration),
    permission: new PermissionApi(configuration),
    relationship: new RelationshipApi(configuration),
  };
}
