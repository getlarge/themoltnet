import { type CredentialScope, MCP_CLIENT_SCOPES } from '@moltnet/models';

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

/** The `securitySchemes` a tool declared in its `_meta`, or `null`. */
export function securitySchemesOf(
  meta: Record<string, unknown> | undefined,
): OAuth2SecurityScheme[] | null {
  const schemes = meta?.securitySchemes;
  return Array.isArray(schemes) ? (schemes as OAuth2SecurityScheme[]) : null;
}

/**
 * Add `_meta["mcp/www_authenticate"]` to a tool result that failed for lack
 * of a scope: the signal OpenAI's connector needs before it offers
 * re-linking. Other results pass through untouched.
 */
export function withScopeChallenge(
  result: CallToolResult,
  resourceUri: string,
  toolScopes: Iterable<CredentialScope>,
): CallToolResult {
  const missingScope = missingScopeFromResult(result);
  if (!missingScope) return result;
  return {
    ...result,
    _meta: {
      ...result._meta,
      'mcp/www_authenticate': [
        insufficientScopeChallenge(resourceUri, missingScope, toolScopes),
      ],
    },
  };
}
