import { DCR_MAX_SCOPES } from '@moltnet/models';
import type { FastifyInstance } from 'fastify';

/**
 * Scopes advertised to MCP clients as the ones this resource server accepts.
 *
 * `DCR_MAX_SCOPES` is deliberate: it is exactly the set a self-registered
 * client is granted at registration (Ory's
 * `dynamic_client_registration.default_scope`), so a client that mirrors this
 * list into its authorization request always asks for something its own
 * registration already covers.
 */
export const RESOURCE_SCOPES_SUPPORTED: readonly string[] = DCR_MAX_SCOPES;

/**
 * RFC 9728 protected resource metadata. `@getlarge/fastify-mcp` serves these
 * with only `resource` and `authorization_servers`, and constrains them with a
 * Fastify response schema that strips anything else at serialization time.
 *
 * `scopes_supported` is optional in RFC 9728 but load-bearing for MCP: the
 * `WWW-Authenticate` challenge on a 401 points clients here, and a client with
 * no other signal has no way to learn which scopes this resource needs. One
 * that declines to guess ends up requesting bare OIDC scopes and is then
 * refused by the REST API for lacking, say, `team:read`.
 */
const SCOPE_ADDITIVE_PATHS = new Set([
  '/.well-known/oauth-protected-resource',
  '/.well-known/oauth-protected-resource/mcp',
]);

/**
 * The plugin's non-standard OIDC discovery document hardcodes
 * `['read', 'write', 'mcp:resources', 'mcp:prompts', 'mcp:tools']` — none of
 * which exist in MoltNet — with no configuration hook. Overwrite it with the
 * real set so a client reading this document is not actively misled.
 *
 * Its `authorization_endpoint`, `token_endpoint` and
 * `token_introspection_endpoint` are hardcoded too and also wrong for Ory, but
 * they cannot be corrected here: Ory Network serves the token endpoint from a
 * different host than the issuer, and that host is not derivable from this
 * app's configuration. Fixing those belongs upstream.
 */
const SCOPE_OVERWRITE_PATHS = new Set([
  '/.well-known/openid-configuration/mcp',
]);

function pathOf(url: string): string {
  const queryIndex = url.indexOf('?');
  return queryIndex === -1 ? url : url.slice(0, queryIndex);
}

/**
 * Patch `scopes_supported` into the OAuth discovery documents served by
 * `@getlarge/fastify-mcp`.
 *
 * This runs in `onSend` rather than `preSerialization` on purpose: the plugin's
 * response schemas drop undeclared properties during serialization, so a field
 * added any earlier would never reach the wire. Register before the MCP plugin
 * so the hook is in scope for its routes.
 */
export function registerWellKnownMetadata(app: FastifyInstance): void {
  app.addHook('onSend', (request, reply, payload, done) => {
    const path = pathOf(request.url);
    const additive = SCOPE_ADDITIVE_PATHS.has(path);
    const overwrite = SCOPE_OVERWRITE_PATHS.has(path);

    if (
      (!additive && !overwrite) ||
      request.method !== 'GET' ||
      reply.statusCode !== 200 ||
      typeof payload !== 'string'
    ) {
      done(null, payload);
      return;
    }

    let metadata: Record<string, unknown>;
    try {
      metadata = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      // Not our document to rewrite — leave the response untouched.
      done(null, payload);
      return;
    }

    // Once the plugin learns to emit this itself, defer to it.
    if (additive && 'scopes_supported' in metadata) {
      done(null, payload);
      return;
    }

    const patched = JSON.stringify({
      ...metadata,
      scopes_supported: [...RESOURCE_SCOPES_SUPPORTED],
    });
    reply.header('content-length', Buffer.byteLength(patched));
    done(null, patched);
  });
}
