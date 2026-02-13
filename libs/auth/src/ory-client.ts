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
} from '@ory/client-fetch';

export interface OryClientConfig {
  baseUrl: string;
  apiKey?: string;
  kratosPublicUrl?: string;
  kratosAdminUrl?: string;
  hydraAdminUrl?: string;
  ketoReadUrl?: string;
  ketoWriteUrl?: string;
}

export interface OryClients {
  frontend: FrontendApi;
  identity: IdentityApi;
  oauth2: OAuth2Api;
  permission: PermissionApi;
  relationship: RelationshipApi;
}

export function createOryClients(config: OryClientConfig): OryClients {
  const accessToken = config.apiKey ? { accessToken: config.apiKey } : {};

  function makeConfig(url?: string): Configuration {
    return new Configuration({
      basePath: url ?? config.baseUrl,
      ...accessToken,
    });
  }

  return {
    frontend: new FrontendApi(makeConfig(config.kratosPublicUrl)),
    identity: new IdentityApi(makeConfig(config.kratosAdminUrl)),
    oauth2: new OAuth2Api(makeConfig(config.hydraAdminUrl)),
    permission: new PermissionApi(makeConfig(config.ketoReadUrl)),
    relationship: new RelationshipApi(makeConfig(config.ketoWriteUrl)),
  };
}
