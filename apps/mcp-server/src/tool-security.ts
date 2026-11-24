import type { Tool, ToolHandler } from '@getlarge/fastify-mcp';
import { type CredentialScope, MCP_CLIENT_SCOPES } from '@moltnet/models';
import type { FastifyInstance } from 'fastify';
import type { TObject } from 'typebox';

import type { CallToolResult } from './types.js';

export interface OAuth2SecurityScheme {
  type: 'oauth2';
  scopes: CredentialScope[];
}

/**
 * `securitySchemes` value for a tool: the scopes required by the REST
 * operations its handler calls. Declare it in the tool's `_meta`.
 *
 * OpenAI's connector (ChatGPT, Codex apps) requests these when it links an
 * account; without them it asked only for OIDC scopes and every diary call
 * failed with `Missing required scope` (issue #2967). Call it with no scopes
 * for tools whose REST routes are public or that make no REST call — the MCP
 * endpoint still requires a token.
 */
export function oauthScopes(
  ...scopes: CredentialScope[]
): OAuth2SecurityScheme[] {
  return [{ type: 'oauth2', scopes }];
}

const MISSING_SCOPE_PATTERN = /Missing required scope: ([a-z]+:[a-z]+)/;

/**
 * The scope a REST 403 reported as missing, if the tool result carries one.
 *
 * Handlers flatten REST problems into `{ error: <detail> }` text, so the
 * detail string is the only signal left here. Only a known MCP scope is
 * returned, which keeps arbitrary text out of the challenge built from it.
 */
export function missingScopeFromResult(
  result: CallToolResult,
): CredentialScope | null {
  if (!result.isError) return null;
  for (const item of result.content ?? []) {
    if (item.type !== 'text') continue;
    const scope = MISSING_SCOPE_PATTERN.exec(item.text)?.[1];
    if (scope && (MCP_CLIENT_SCOPES as readonly string[]).includes(scope)) {
      return scope as CredentialScope;
    }
  }
  return null;
}

/**
 * RFC 6750 `insufficient_scope` challenge. It asks for every scope the MCP
 * tools declare, not only the missing one: a client that re-links replaces its
 * grant, so requesting just the missing scope would trade one denial for
 * another.
 */
export function insufficientScopeChallenge(
  resourceUri: string,
  missingScope: CredentialScope,
  toolScopes: Iterable<CredentialScope>,
): string {
  return [
    `Bearer resource_metadata="${resourceUri}/.well-known/oauth-protected-resource"`,
    'error="insufficient_scope"',
    `scope="${[...toolScopes].join(' ')}"`,
    `error_description="This connection was not granted ${missingScope}. Reconnect MoltNet to grant it."`,
  ].join(', ');
}

/**
 * Enforce and publish each tool's `_meta.securitySchemes`, and turn REST scope
 * denials into OAuth step-up challenges.
 *
 * Tools declare their schemes in `_meta` (the plugin's `Tool` type has no
 * top-level field for it); this copies them top-level as well, the placement
 * OpenAI documents as primary. A denial gains `_meta["mcp/www_authenticate"]`,
 * the signal OpenAI's connector needs before it offers re-linking.
 *
 * `resourceUri` is unset when authorization is disabled; no challenge is
 * added then.
 */
export function installToolSecurityPolicy(
  app: FastifyInstance,
  { resourceUri }: { resourceUri?: string },
): void {
  const addTool = app.mcpAddTool.bind(app);
  const toolScopes = new Set<CredentialScope>();

  app.mcpAddTool = (<TSchema extends TObject>(
    definition: Omit<Tool, 'inputSchema'> & { inputSchema: TSchema },
    handler?: ToolHandler<TSchema>,
  ) => {
    const securitySchemes = definition._meta?.securitySchemes as
      | OAuth2SecurityScheme[]
      | undefined;
    if (!securitySchemes) {
      throw new Error(
        `MCP tool ${definition.name} must declare _meta.securitySchemes`,
      );
    }
    for (const scheme of securitySchemes) {
      for (const scope of scheme.scopes) toolScopes.add(scope);
    }

    const withChallenge: ToolHandler<TSchema> | undefined =
      handler && resourceUri
        ? async (params, context) => {
            const result = await handler(params, context);
            const missingScope = missingScopeFromResult(result);
            if (!missingScope) return result;
            return {
              ...result,
              _meta: {
                ...result._meta,
                'mcp/www_authenticate': [
                  insufficientScopeChallenge(
                    resourceUri,
                    missingScope,
                    toolScopes,
                  ),
                ],
              },
            };
          }
        : handler;

    addTool(
      { ...definition, securitySchemes } as typeof definition,
      withChallenge,
    );
  }) as typeof app.mcpAddTool;
}
