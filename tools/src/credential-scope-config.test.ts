import { readFileSync } from 'node:fs';

import {
  DCR_MAX_SCOPES,
  MCP_CLIENT_SCOPES,
  OIDC_PROTOCOL_SCOPES,
} from '@moltnet/models';
import { describe, expect, it } from 'vitest';

function readJson(relativePath: string): unknown {
  return JSON.parse(
    readFileSync(new URL(relativePath, import.meta.url), 'utf8'),
  ) as unknown;
}

function readHydraDefaultScopes(relativePath: string): string[] {
  const yaml = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  const block = yaml.match(/^ {4}default_scope:\n((?: {6}- [^\n]+\n)+)/mu)?.[1];
  if (!block) throw new Error('Hydra dynamic-client default_scope not found');
  return [...block.matchAll(/^ {6}- (.+)$/gmu)].map((match) => match[1]!);
}

describe('credential scope configuration', () => {
  it('caps Ory dynamic-client defaults at the MCP tool surface', () => {
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

    expect(configured).toEqual([...DCR_MAX_SCOPES]);
    expect(new Set(configured).size).toBe(configured.length);

    const localConfigured = readHydraDefaultScopes(
      '../../infra/ory/hydra/hydra.yaml',
    );
    // The local file lists capability scopes only; Hydra adds the OIDC
    // protocol scopes itself, which is why prod carries them and this does not.
    expect(localConfigured).toEqual([...MCP_CLIENT_SCOPES]);
    expect(new Set(localConfigured).size).toBe(localConfigured.length);

    // The point of the cap: self-registration cannot reach privileged scopes.
    for (const denied of [
      'key:manage',
      'runtime:manage',
      'connector:invoke',
      'runtime:read',
      'task:claim',
    ]) {
      expect(configured).not.toContain(denied);
      expect(localConfigured).not.toContain(denied);
    }
    expect(OIDC_PROTOCOL_SCOPES.every((s) => configured.includes(s))).toBe(
      true,
    );
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
