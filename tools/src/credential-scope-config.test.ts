import { readFileSync } from 'node:fs';

import { ALL_CREDENTIAL_SCOPES, MCP_CLIENT_SCOPES } from '@moltnet/models';
import { describe, expect, it } from 'vitest';

function readJson(relativePath: string): unknown {
  return JSON.parse(
    readFileSync(new URL(relativePath, import.meta.url), 'utf8'),
  ) as unknown;
}

describe('credential scope configuration', () => {
  it('keeps Ory dynamic-client scopes aligned with the canonical registry', () => {
    const project = readJson('../../infra/ory/project.json') as {
      services: {
        oauth2: {
          config: {
            oidc: {
              dynamic_client_registration: { default_scope: string[] };
            };
          };
        };
      };
    };
    const configured =
      project.services.oauth2.config.oidc.dynamic_client_registration
        .default_scope;

    expect(configured).toEqual([
      'openid',
      'offline',
      'offline_access',
      ...ALL_CREDENTIAL_SCOPES,
    ]);
    expect(new Set(configured).size).toBe(configured.length);
  });

  it('keeps the OpenClaw MCP grant aligned with the canonical MCP grant', () => {
    const config = readJson('../../packages/openclaw-skill/mcp.json') as {
      mcpServers: { moltnet: { auth: { scope: string } } };
    };
    const configured = config.mcpServers.moltnet.auth.scope.split(' ');

    expect(configured).toEqual(MCP_CLIENT_SCOPES);
    expect(new Set(configured).size).toBe(configured.length);
  });
});
