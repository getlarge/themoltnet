/**
 * `/v1/catalogue`: what this identity can compose a run from.
 *
 * The route reaches the MoltNet API with agent credentials, so it is both a
 * contract surface and an authorization surface — hence the full-body
 * assertion alongside the native-authorization and scope cases.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Catalogue, CatalogueAgentPort } from './catalogue.js';
import { AGENT_SERVER_TOKEN_HEADER } from './server.js';
import {
  activateManaged,
  authorize,
  cleanupAll,
  fixture,
  HOST,
  TEST_CLIENT_ORIGIN,
} from './server-test-harness.js';

afterEach(cleanupAll);

describe('run catalogue', () => {
  const TEAM = '4f2a91c8-1d3e-4b77-9a02-6c1b8e7d5a40';

  /** A fake authenticated agent standing in for the SDK client. */
  const credential = {
    keyId: 'key-1',
    expiresAt: null,
    verifiedAt: '2026-09-18T12:00:00.000Z',
    scopes: ['team:read', 'diary:read'],
  };
  const data = {
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

  const catalogueAgent: CatalogueAgentPort = {
    teamIds: [TEAM],
    lastVerified: () => credential,
    readProjects: () =>
      Promise.resolve({
        items: [
          {
            id: '8939be63-d0b5-4a9c-8c27-cc1a4e161eb4',
            teamId: TEAM,
            name: 'Research',
            description: null,
            defaultDiaryId: null,
            archived: false,
          },
        ],
        truncated: false,
      }),
    readProject: () => Promise.resolve(null),
    readTeam: async () => ({
      team: (await data.listTeams())[0],
      diaries: await data.listDiaries(),
      profiles: (await data.listProfiles()) as Awaited<
        ReturnType<CatalogueAgentPort['readTeam']>
      >['profiles'],
      credential,
    }),
  };

  it('returns the teams, diaries and profiles the identity can serve', async () => {
    // Arrange
    const { app, store } = await fixture({
      catalogueAgentFor: () => Promise.resolve(catalogueAgent),
    });
    const token = await authorize(app);
    activateManaged(store);

    // Act
    const response = await app.inject({
      method: 'GET',
      url: '/v1/catalogue?identity=course-bot',
      headers: {
        host: HOST,
        origin: TEST_CLIENT_ORIGIN,
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
          available: true,
          blockers: [],
          credential,
          diaries: [{ id: 'diary-1', name: 'themoltnet' }],
          defaultDiaryId: 'diary-1',
        },
      ],
      defaultTeamId: TEAM,
      projects: [
        {
          id: '8939be63-d0b5-4a9c-8c27-cc1a4e161eb4',
          teamId: TEAM,
          name: 'Research',
          description: null,
          defaultDiaryId: null,
          archived: false,
        },
      ],
      projectErrors: [],
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

  it('requires native authorization', async () => {
    // The catalogue reaches the MoltNet API with agent credentials, so it must
    // not be readable by an unauthorized caller.
    const { app, store } = await fixture({
      catalogueAgentFor: () => Promise.resolve(catalogueAgent),
    });
    activateManaged(store);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/catalogue?identity=course-bot',
      headers: { host: HOST, origin: TEST_CLIENT_ORIGIN },
    });

    expect(response.statusCode).toBe(401);
  });

  it('answers 404 for an identity that is not activated here', async () => {
    // Arrange
    const { app } = await fixture({
      catalogueAgentFor: () => Promise.resolve(catalogueAgent),
    });
    const token = await authorize(app);

    // Act
    const response = await app.inject({
      method: 'GET',
      url: '/v1/catalogue?identity=missing-bot',
      headers: {
        host: HOST,
        origin: TEST_CLIENT_ORIGIN,
        [AGENT_SERVER_TOKEN_HEADER]: token,
      },
    });

    // Assert
    expect(response.statusCode).toBe(404);
  });

  it('sanitizes resource denial without misdiagnosing missing scopes', async () => {
    // A resource authorization denial is not evidence about credential scopes.
    const stale = Object.assign(new Error('upstream-secret-sentinel'), {
      statusCode: 403,
    });
    const { app, store } = await fixture({
      catalogueAgentFor: () =>
        Promise.resolve({
          ...catalogueAgent,
          readTeam: () => Promise.reject(stale),
        }),
    });
    const token = await authorize(app);
    activateManaged(store);

    // Act
    const response = await app.inject({
      method: 'GET',
      url: '/v1/catalogue?identity=course-bot',
      headers: {
        host: HOST,
        origin: TEST_CLIENT_ORIGIN,
        [AGENT_SERVER_TOKEN_HEADER]: token,
      },
    });

    // Assert
    expect(response.statusCode).toBe(200);
    const body = response.json<Catalogue>();
    expect(body.teams[0]).toMatchObject({
      available: false,
      credential,
      blockers: [{ code: 'agent_key_unavailable' }],
    });
    expect(body.defaultTeamId).toBeNull();
    expect(body.profiles).toEqual([]);
    expect(response.body).not.toContain('upstream-secret-sentinel');
  });

  it('rejects a request with no identity', async () => {
    // Arrange
    const { app, store } = await fixture({
      catalogueAgentFor: () => Promise.resolve(catalogueAgent),
    });
    const token = await authorize(app);
    activateManaged(store);

    // Act
    const response = await app.inject({
      method: 'GET',
      url: '/v1/catalogue',
      headers: {
        host: HOST,
        origin: TEST_CLIENT_ORIGIN,
        [AGENT_SERVER_TOKEN_HEADER]: token,
      },
    });

    // Assert
    expect(response.statusCode).toBe(400);
  });

  describe('shared reads', () => {
    async function setup(port: CatalogueAgentPort) {
      const { app, store } = await fixture({
        catalogueAgentFor: () => Promise.resolve(port),
      });
      const token = await authorize(app);
      activateManaged(store);
      const headers = {
        host: HOST,
        origin: TEST_CLIENT_ORIGIN,
        [AGENT_SERVER_TOKEN_HEADER]: token,
      };
      const read = () =>
        app.inject({
          method: 'GET',
          url: '/v1/catalogue?identity=course-bot',
          headers,
        });
      return { app, headers, read };
    }

    it('verifies team credentials once for concurrent and repeated reads', async () => {
      // Arrange: the Run Center poll, the tray and a view refreshing at once.
      const readTeam = vi.fn((teamId: string, signal?: AbortSignal) =>
        catalogueAgent.readTeam(teamId, signal),
      );
      const { read } = await setup({ ...catalogueAgent, readTeam });

      // Act
      const responses = await Promise.all([read(), read(), read()]);
      const later = await read();

      // Assert
      for (const response of [...responses, later])
        expect(response.statusCode).toBe(200);
      expect(readTeam).toHaveBeenCalledTimes(1);
    });

    it('re-reads a degraded catalogue instead of serving the failure again', async () => {
      // Arrange: a freshly renewed credential that the API rejects once.
      const readTeam = vi
        .fn((teamId: string, signal?: AbortSignal) =>
          catalogueAgent.readTeam(teamId, signal),
        )
        .mockRejectedValueOnce(new Error('not yet verifiable'));
      const { read } = await setup({ ...catalogueAgent, readTeam });

      // Act
      const first = (await read()).json<Catalogue>();
      const second = (await read()).json<Catalogue>();

      // Assert
      expect(first.teams[0]?.available).toBe(false);
      expect(second.teams[0]?.available).toBe(true);
    });

    it('drops the shared read after a successful administrative change', async () => {
      // Arrange
      const readTeam = vi.fn((teamId: string, signal?: AbortSignal) =>
        catalogueAgent.readTeam(teamId, signal),
      );
      const { app, headers, read } = await setup({
        ...catalogueAgent,
        readTeam,
      });
      await read();

      // Act
      const changed = await app.inject({
        method: 'POST',
        url: '/v1/operator/cancel',
        headers,
      });
      await read();

      // Assert
      expect(changed.statusCode).toBe(200);
      expect(readTeam).toHaveBeenCalledTimes(2);
    });

    it('keeps the shared read after a refused change', async () => {
      // Arrange
      const readTeam = vi.fn((teamId: string, signal?: AbortSignal) =>
        catalogueAgent.readTeam(teamId, signal),
      );
      const { app, headers, read } = await setup({
        ...catalogueAgent,
        readTeam,
      });
      await read();

      // Act
      const refused = await app.inject({
        method: 'POST',
        url: '/v1/agents',
        headers: { ...headers, 'content-type': 'application/json' },
        payload: { kind: 'managed', name: 'orphan-bot' },
      });
      await read();

      // Assert
      expect(refused.statusCode).toBe(400);
      expect(readTeam).toHaveBeenCalledTimes(1);
    });
  });
});
