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

/**
 * Read a boolean under `oauth2.client_credentials` from the local Hydra YAML.
 *
 * Deliberately a targeted regex rather than a YAML parse: this file is the
 * only consumer, and pulling in a parser to read one flag would make the
 * contract heavier than the thing it guards.
 */
function readHydraClientCredentialsFlag(
  relativePath: string,
  key: string,
): boolean {
  const yaml = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  const block = yaml.match(
    /^ {2}client_credentials:\n((?: {4}[^\n]+\n)+)/mu,
  )?.[1];
  if (!block)
    throw new Error('Hydra oauth2.client_credentials block not found');
  const line = block.match(new RegExp(`^ {4}${key}: (\\S+)$`, 'mu'));
  if (!line) throw new Error(`Hydra ${key} not found under client_credentials`);
  return line[1] === 'true';
}

function readHydraSupportedScopes(relativePath: string): string[] {
  const yaml = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  const block = yaml.match(/^ {4}supported_scope:\n((?: {6}- [^\n]+\n)+)/mu)?.[1];
  if (!block) throw new Error('Hydra webfinger supported_scope not found');
  return [...block.matchAll(/^ {6}- (.+)$/gmu)].map((match) => match[1]!);
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

describe('Ory environment parity', () => {
  // infra/ory/project.json configures Ory Network; infra/ory/hydra/hydra.yaml
  // configures the local and e2e Hydra. They are separate deployments, not
  // duplicates, so nothing makes them agree on its own.
  //
  // #2162 is what this guards against: project.json said `false` while
  // hydra.yaml said `true`. `ory update project` pushes project.json, so
  // production silently ran with the stricter value while local ran with the
  // looser one — and every agent 403'd once scope enforcement went live.
  it('keeps default_grant_allowed_scope aligned across both environments', () => {
    const project = readJson('../../infra/ory/project.json') as {
      services: {
        oauth2: {
          config: {
            oauth2: {
              client_credentials: { default_grant_allowed_scope: boolean };
            };
          };
        };
      };
    };
    const configured =
      project.services.oauth2.config.oauth2.client_credentials
        .default_grant_allowed_scope;
    const localConfigured = readHydraClientCredentialsFlag(
      '../../infra/ory/hydra/hydra.yaml',
      'default_grant_allowed_scope',
    );

    expect(localConfigured).toBe(configured);
  });

  // `true` is a deliberate, temporary state (#2162): it stops an outage caused
  // by clients that request no scope, at the cost of granting them everything
  // they registered for. Restoring `false` is the intended end state, and is
  // safe only once every client_credentials consumer sends `scope` — the SDK
  // (token.ts) and CLI (token.go) already do, but released CLI binaries
  // predating that fix do not. Flip both files together; this test will fail
  // until you do, which is the point.
  it('documents that the relaxed grant is the current, intentional value', () => {
    const localConfigured = readHydraClientCredentialsFlag(
      '../../infra/ory/hydra/hydra.yaml',
      'default_grant_allowed_scope',
    );

    expect(localConfigured).toBe(true);
  });
});

describe('advertised scopes', () => {
  // `scopes_supported` in the discovery document is how a client learns what it
  // may request. Before this was set, Hydra advertised only its three built-in
  // OIDC scopes, so an MCP client could not discover `diary:read` at all — it
  // only ever received whatever dynamic_client_registration.default_scope
  // handed it, which is why clients ended up registered for the full agent
  // grant.
  //
  // Verified against Hydra v25.4.0: this list is advertisement, not
  // enforcement. A client registered for a scope outside it still reaches
  // login; `invalid_scope` is raised only for scopes the client's own
  // registration lacks.
  it('advertises exactly the MCP tool surface in both environments', () => {
    const project = readJson('../../infra/ory/project.json') as {
      services: {
        oauth2: {
          config: {
            webfinger: { oidc_discovery: { supported_scope: string[] } };
          };
        };
      };
    };
    const configured =
      project.services.oauth2.config.webfinger.oidc_discovery.supported_scope;
    const localConfigured = readHydraSupportedScopes(
      '../../infra/ory/hydra/hydra.yaml',
    );

    expect(configured).toEqual([...MCP_CLIENT_SCOPES]);
    expect(localConfigured).toEqual([...MCP_CLIENT_SCOPES]);
  });

  it('never advertises a scope the token hook would then refuse', () => {
    const localConfigured = readHydraSupportedScopes(
      '../../infra/ory/hydra/hydra.yaml',
    );

    // Hydra always adds openid/offline/offline_access, so what a client sees is
    // those plus this list — which must land exactly on the enforced cap.
    expect([...OIDC_PROTOCOL_SCOPES, ...localConfigured].sort()).toEqual(
      [...DCR_MAX_SCOPES].sort(),
    );
    for (const privileged of [
      'key:manage',
      'runtime:manage',
      'connector:invoke',
      'runtime:read',
      'task:claim',
    ]) {
      expect(localConfigured).not.toContain(privileged);
    }
  });
});
