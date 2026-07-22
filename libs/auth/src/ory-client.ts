/**
 * @moltnet/auth — Ory SDK Client Factory
 *
 * Creates configured instances of all Ory API clients.
 */

import {
  ApiKeysApi,
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
  talosAdminUrl?: string;
  /** Timeout for Talos verification requests (default: 5 seconds). */
  talosRequestTimeoutMs?: number;
}

export interface OryClients {
  frontend: FrontendApi;
  identity: IdentityApi;
  oauth2: OAuth2Api;
  permission: PermissionApi;
  /** Write-only Keto client (admin port) — use for mutations */
  relationship: RelationshipApi;
  /** Read-only Keto client (read port) — use for queries */
  relationshipRead: RelationshipApi;
  /** Talos admin client; absent when Talos authentication is disabled. */
  apiKeys?: ApiKeysApi;
}

export function createOryClients(config: OryClientConfig): OryClients {
  const accessToken = config.apiKey ? { accessToken: config.apiKey } : {};

  function makeConfig(url?: string): Configuration {
    return new Configuration({
      basePath: url ?? config.baseUrl,
      ...accessToken,
    });
  }

  function makeTalosConfig(url: string): Configuration {
    const timeoutMs = config.talosRequestTimeoutMs ?? 5_000;
    return new Configuration({
      basePath: url,
      ...accessToken,
      fetchApi: async (input, init) => {
        const timeoutSignal = AbortSignal.timeout(timeoutMs);
        const signal = init?.signal
          ? AbortSignal.any([init.signal, timeoutSignal])
          : timeoutSignal;
        return globalThis.fetch(input, { ...init, signal });
      },
    });
  }

  const identity = new IdentityApi(makeConfig(config.kratosAdminUrl));

  // listIdentitySchemas hits GET /schemas — a public endpoint. When called
  // via the admin port, Kratos redirects to serve.public.base_url which may
  // resolve to localhost (unreachable from Docker containers). Delegate to
  // a public-URL instance so the request goes directly to the public port.
  if (
    config.kratosPublicUrl &&
    config.kratosPublicUrl !== config.kratosAdminUrl
  ) {
    const publicIdentity = new IdentityApi(makeConfig(config.kratosPublicUrl));
    identity.listIdentitySchemas =
      publicIdentity.listIdentitySchemas.bind(publicIdentity);
  }

  return {
    frontend: new FrontendApi(makeConfig(config.kratosPublicUrl)),
    identity,
    oauth2: new OAuth2Api(makeConfig(config.hydraAdminUrl)),
    permission: new PermissionApi(makeConfig(config.ketoReadUrl)),
    relationship: new RelationshipApi(makeConfig(config.ketoWriteUrl)),
    relationshipRead: new RelationshipApi(makeConfig(config.ketoReadUrl)),
    ...(config.talosAdminUrl
      ? { apiKeys: new ApiKeysApi(makeTalosConfig(config.talosAdminUrl)) }
      : {}),
  };
}
