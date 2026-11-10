import { DCR_MAX_SCOPES } from '@moltnet/models';
import type { FastifyInstance } from 'fastify';

/**
 * Scopes advertised to MCP clients as the ones this resource server accepts.
 *
 * `DCR_MAX_SCOPES` includes optional OIDC identity scopes that clients may
 * explicitly request at registration. The MCP capabilities in this list match
 * Ory's dynamic-registration defaults.
 */
export const RESOURCE_SCOPES_SUPPORTED: readonly string[] = DCR_MAX_SCOPES;

export interface ProtectedResourceMetadataOptions {
  resourceUri: string;
  authorizationServers: string[];
}

/**
 * RFC 9728 protected resource metadata, at the root well-known path and at
 * the path-suffixed variant for the `/mcp` resource.
 *
 * `scopes_supported` is optional in RFC 9728 but load-bearing for MCP: the
 * `WWW-Authenticate` challenge on a 401 points clients here, and a client with
 * no other signal has no way to learn which scopes this resource needs. One
 * that declines to guess ends up requesting bare OIDC scopes and is then
 * refused by the REST API for lacking, say, `team:read`.
 */
export function registerProtectedResourceMetadata(
  app: FastifyInstance,
  { resourceUri, authorizationServers }: ProtectedResourceMetadataOptions,
): void {
  const document = (resource: string) => ({
    resource,
    authorization_servers: authorizationServers,
    scopes_supported: [...RESOURCE_SCOPES_SUPPORTED],
  });

  app.get('/.well-known/oauth-protected-resource', () => document(resourceUri));
  app.get('/.well-known/oauth-protected-resource/mcp', () =>
    document(`${resourceUri.replace(/\/+$/, '')}/mcp`),
  );
}
