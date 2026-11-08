/**
 * E2E: interactive connector OAuth scopes (issue #2967)
 *
 * OpenAI's connector (ChatGPT, Codex apps) links with the OIDC scopes the
 * authorization server advertises unless MCP tools declare `securitySchemes`.
 * Hydra grants only what the authorize request asks for, so such a token
 * reaches MoltNet without `diary:read` even though the client registration
 * allows it, and every diary tool fails with `Missing required scope`.
 *
 * These tests drive the real DCR + login + consent + PKCE flow, then talk to
 * the MCP server with the resulting bearer token through the MCP SDK client.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  ListToolsResultSchema,
  ToolSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { MCP_CLIENT_SCOPES } from '@moltnet/models';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  authorizeConnector,
  type ConnectorAuthorization,
  createHuman,
  type E2EHuman,
  grantedScopes,
  refreshConnectorToken,
} from './human-oauth.js';

/** What a well-behaved client registers: everything MoltNet advertises. */
const REGISTERED_SCOPES = [
  'openid',
  'offline',
  'offline_access',
  ...MCP_CLIENT_SCOPES,
  'email',
  'profile',
];

/** What OpenAI's connector requests when no tool declares securitySchemes. */
const OIDC_ONLY_SCOPES = ['openid', 'offline_access', 'email', 'profile'];

interface ToolResult {
  isError?: boolean;
  content: Array<{ type: string; text?: string }>;
  _meta?: Record<string, unknown>;
}

describe('Connector OAuth scopes', () => {
  const clients: Client[] = [];
  let human: E2EHuman;

  async function connect(accessToken: string): Promise<Client> {
    const transport = new StreamableHTTPClientTransport(
      new URL(`${process.env.MCP_SERVER_URL}/mcp`),
      { requestInit: { headers: { Authorization: `Bearer ${accessToken}` } } },
    );
    const client = new Client({ name: 'connector-scope-e2e', version: '1' });
    await client.connect(transport);
    clients.push(client);
    return client;
  }

  beforeAll(async () => {
    human = await createHuman();
  });

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()));
  });

  it('advertises the scopes each tool needs as securitySchemes', async () => {
    // Arrange
    const authorization = await authorizeConnector(human, {
      clientName: 'E2E Connector (tools/list)',
      registeredScopes: REGISTERED_SCOPES,
      requestedScopes: OIDC_ONLY_SCOPES,
    });
    const client = await connect(authorization.accessToken);

    // Act — `client.listTools()` parses with the SDK's ToolSchema, which
    // strips unknown top-level keys (the reason OpenAI documents the `_meta`
    // mirror). Read the wire payload with a passthrough variant instead.
    const { tools } = await client.request(
      { method: 'tools/list' },
      ListToolsResultSchema.extend({
        tools: ToolSchema.passthrough().array(),
      }),
    );

    // Assert
    const diariesList = tools.find((tool) => tool.name === 'diaries_list');
    const expected = [{ type: 'oauth2', scopes: ['diary:read'] }];
    expect(diariesList?.securitySchemes).toEqual(expected);
    expect(diariesList?._meta?.securitySchemes).toEqual(expected);
    for (const tool of tools) {
      expect(tool.securitySchemes, tool.name).toBeDefined();
      expect(tool._meta?.securitySchemes, tool.name).toEqual(
        tool.securitySchemes,
      );
    }
  });

  describe('authorized with OIDC scopes only', () => {
    let authorization: ConnectorAuthorization;

    beforeAll(async () => {
      authorization = await authorizeConnector(human, {
        clientName: 'E2E OIDC-only Connector',
        registeredScopes: REGISTERED_SCOPES,
        requestedScopes: OIDC_ONLY_SCOPES,
      });
    });

    it('gets a token without diary:read although the client registered it', async () => {
      const scopes = await grantedScopes(authorization.accessToken);

      expect(scopes).not.toContain('diary:read');
      expect(scopes).toEqual(
        expect.arrayContaining(['openid', 'offline_access']),
      );
    });

    it('keeps the narrow grant across refreshes, so retrying never heals it', async () => {
      const refreshed = await refreshConnectorToken(authorization);

      const scopes = await grantedScopes(refreshed);

      expect(scopes).not.toContain('diary:read');
    });

    it('fails diaries_list with an insufficient_scope challenge', async () => {
      // Arrange
      const client = await connect(authorization.accessToken);

      // Act
      const result = (await client.callTool({
        name: 'diaries_list',
        arguments: {},
      })) as ToolResult;

      // Assert
      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content[0]?.text ?? '{}')).toEqual({
        error: 'Missing required scope: diary:read',
      });
      const challenges = result._meta?.['mcp/www_authenticate'] as
        | string[]
        | undefined;
      expect(challenges).toHaveLength(1);
      const [challenge] = challenges!;
      expect(challenge).toMatch(
        /^Bearer resource_metadata="[^"]+\/\.well-known\/oauth-protected-resource"/,
      );
      expect(challenge).toContain('error="insufficient_scope"');
      expect(challenge).toMatch(/scope="[^"]*\bdiary:read\b[^"]*"/);
      expect(challenge).toContain('error_description="');
    });

    it('fails entries_search the same way', async () => {
      const client = await connect(authorization.accessToken);

      const result = (await client.callTool({
        name: 'entries_search',
        arguments: { query: 'anything' },
      })) as ToolResult;

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain(
        'Missing required scope: diary:read',
      );
      expect(result._meta?.['mcp/www_authenticate']).toBeDefined();
    });
  });

  it('lists diaries once the connector requests the declared scopes', async () => {
    // Arrange
    const authorization = await authorizeConnector(human, {
      clientName: 'E2E Connector (declared scopes)',
      registeredScopes: REGISTERED_SCOPES,
      requestedScopes: ['openid', 'offline_access', ...MCP_CLIENT_SCOPES],
    });
    const client = await connect(authorization.accessToken);

    // Act
    const result = (await client.callTool({
      name: 'diaries_list',
      arguments: {},
    })) as ToolResult;

    // Assert
    expect(result.isError, result.content[0]?.text).toBeFalsy();
    expect(result._meta?.['mcp/www_authenticate']).toBeUndefined();
  });
});
