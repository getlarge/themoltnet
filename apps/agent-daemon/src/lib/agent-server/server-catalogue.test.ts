/**
 * `/v1/catalogue`: what this identity can compose a run from.
 *
 * The route reaches the MoltNet API with agent credentials, so it is both a
 * contract surface and an authorization surface — hence the full-body
 * assertion alongside the paired-origin and scope cases.
 */
import { afterEach, describe, expect, it } from 'vitest';

import type { CatalogueAgentPort } from './catalogue.js';
import { AGENT_SERVER_TOKEN_HEADER } from './server.js';
import {
  activateManaged,
  cleanupAll,
  CONSOLE_ORIGIN,
  fixture,
  HOST,
  pair,
} from './server-test-harness.js';

afterEach(cleanupAll);

describe('run catalogue', () => {
  const TEAM = '4f2a91c8-1d3e-4b77-9a02-6c1b8e7d5a40';

  /** A fake authenticated agent standing in for the SDK client. */
  const catalogueAgent: CatalogueAgentPort = {
    listTeams: () =>
      Promise.resolve([{ id: TEAM, name: 'MoltNet Core', personal: false }]),
    listDiaries: () =>
      Promise.resolve([{ id: 'diary-1', name: 'themoltnet', teamId: TEAM }]),
    listProfiles: () =>
      Promise.resolve([
        {
          id: 'profile-1',
          name: 'opus-review',
          teamId: TEAM,
          description: null,
          provider: 'anthropic',
          model: 'claude-opus-5',
          runtimeKind: 'gondolin_pi',
          toolEnforcement: 'enforce',
          defaultWorkspaceMode: 'dedicated_worktree',
          maxTurns: 40,
          revision: 7,
          definitionCid: 'bafy-test',
          requiredEnv: [],
          requiredTools: [],
          requiredExecutables: [],
        },
      ]),
  };

  it('returns the teams, diaries and profiles the identity can serve', async () => {
    // Arrange
    const { app, store } = await fixture({
      catalogueAgentFor: () => Promise.resolve(catalogueAgent),
    });
    const token = await pair(app);
    activateManaged(store);

    // Act
    const response = await app.inject({
      method: 'GET',
      url: '/v1/catalogue?identity=course-bot',
      headers: {
        host: HOST,
        origin: CONSOLE_ORIGIN,
        [AGENT_SERVER_TOKEN_HEADER]: token,
      },
    });

    // Assert: the *whole* serialized body, not a few keys of it. A Fastify
    // response schema strips properties it does not declare, so a field the
    // handler returns and the schema omits disappears with nothing failing —
    // which is how the composer's policy fields were lost once already. An
    // exact comparison is what notices.
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      teams: [
        {
          teamId: TEAM,
          teamName: 'MoltNet Core',
          diaries: [{ id: 'diary-1', name: 'themoltnet' }],
          defaultDiaryId: 'diary-1',
        },
      ],
      defaultTeamId: TEAM,
      profiles: [
        {
          id: 'profile-1',
          name: 'opus-review',
          teamId: TEAM,
          description: null,
          provider: 'anthropic',
          model: 'claude-opus-5',
          runtimeKind: 'gondolin_pi',
          toolEnforcement: 'enforce',
          defaultWorkspaceMode: 'dedicated_worktree',
          maxTurns: 40,
          revision: 7,
          definitionCid: 'bafy-test',
          requiredEnv: [],
          requiredTools: [],
          requiredExecutables: [],
          ready: true,
          blockers: [],
        },
      ],
    });
  });

  it('requires a paired client', async () => {
    // The catalogue reaches the MoltNet API with agent credentials, so it must
    // not be readable by an unpaired caller.
    const { app, store } = await fixture({
      catalogueAgentFor: () => Promise.resolve(catalogueAgent),
    });
    activateManaged(store);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/catalogue?identity=course-bot',
      headers: { host: HOST, origin: CONSOLE_ORIGIN },
    });

    expect(response.statusCode).toBe(401);
  });

  it('answers 404 for an identity that is not activated here', async () => {
    // Arrange
    const { app } = await fixture({
      catalogueAgentFor: () => Promise.resolve(catalogueAgent),
    });
    const token = await pair(app);

    // Act
    const response = await app.inject({
      method: 'GET',
      url: '/v1/catalogue?identity=missing-bot',
      headers: {
        host: HOST,
        origin: CONSOLE_ORIGIN,
        [AGENT_SERVER_TOKEN_HEADER]: token,
      },
    });

    // Assert
    expect(response.statusCode).toBe(404);
  });

  it('explains a key that predates the catalogue scopes', async () => {
    // A credential's scopes are fixed when it is minted and no key can widen
    // itself, so every key issued before `team:read`/`diary:read` joined the
    // default fails here and can only be replaced by a human in Console. A
    // bare 500 would send the operator looking for a server fault instead.
    const stale = Object.assign(new Error('upstream-secret-sentinel'), {
      statusCode: 403,
    });
    const { app, store } = await fixture({
      catalogueAgentFor: () =>
        Promise.resolve({
          ...catalogueAgent,
          listTeams: () => Promise.reject(stale),
        }),
    });
    const token = await pair(app);
    activateManaged(store);

    // Act
    const response = await app.inject({
      method: 'GET',
      url: '/v1/catalogue?identity=course-bot',
      headers: {
        host: HOST,
        origin: CONSOLE_ORIGIN,
        [AGENT_SERVER_TOKEN_HEADER]: token,
      },
    });

    // Assert
    expect(response.statusCode).toBe(403);
    const body = response.json<{ code: string; message: string }>();
    expect(body.code).toBe('agent_key_scopes_insufficient');
    expect(body.message).toMatch(/team:read/u);
    expect(body.message).toMatch(/Console/u);
    expect(body.message).not.toContain('team:join');
    expect(body.message).not.toContain('upstream-secret-sentinel');
  });

  it('rejects a request with no identity', async () => {
    // Arrange
    const { app, store } = await fixture({
      catalogueAgentFor: () => Promise.resolve(catalogueAgent),
    });
    const token = await pair(app);
    activateManaged(store);

    // Act
    const response = await app.inject({
      method: 'GET',
      url: '/v1/catalogue',
      headers: {
        host: HOST,
        origin: CONSOLE_ORIGIN,
        [AGENT_SERVER_TOKEN_HEADER]: token,
      },
    });

    // Assert
    expect(response.statusCode).toBe(400);
  });
});
