import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { readProjectConfig } from '@themoltnet/sdk/node';
import { afterEach, describe, expect, it } from 'vitest';

import type { CatalogueAgentPort } from './catalogue.js';
import {
  NATIVE_CLIENT_ORIGIN,
  NativeGrantService,
} from './native-grant-service.js';
import { AGENT_SERVER_TOKEN_HEADER } from './server.js';
import {
  activateManaged,
  authorize,
  cleanupAll,
  CONSOLE_ORIGIN,
  fixture,
  HOST,
} from './server-test-harness.js';

afterEach(cleanupAll);
const port: CatalogueAgentPort = {
  teamIds: ['team'],
  lastVerified: () => undefined,
  readTeam: async () => ({
    team: { id: 'team', name: 'Team' },
    diaries: [{ id: 'diary', teamId: 'team', name: 'Diary' }],
    profiles: [],
    credential: {
      keyId: 'key',
      verifiedAt: '2026-09-20T12:00:00Z',
      scopes: ['team:read'],
    },
  }),
  readProjects: async () => [
    {
      id: 'project',
      teamId: 'team',
      name: 'Project',
      description: null,
      defaultDiaryId: 'diary',
      archived: false,
    },
  ],
};
async function setup() {
  const nativeGrant = new NativeGrantService();
  nativeGrant.grantNative('binding-token');
  const result = await fixture({
    nativeGrant,
    catalogueAgentFor: async () => port,
  });
  activateManaged(result.store);
  const source = join(result.store.root, 'checkout');
  await mkdir(source);
  return {
    ...result,
    source,
    payload: {
      identity: 'course-bot',
      name: 'Laptop',
      teamId: 'team',
      projectId: 'project',
      source,
      strategy: 'existing',
      default: true,
    },
  };
}
const headers = {
  host: HOST,
  origin: NATIVE_CLIENT_ORIGIN,
  [AGENT_SERVER_TOKEN_HEADER]: 'binding-token',
};

describe('native project binding administration', () => {
  it('denies an authorized browser local folder access and writes', async () => {
    const { app, payload } = await setup();
    const token = await authorize(app);
    for (const method of ['GET', 'POST', 'DELETE'] as const) {
      const response = await app.inject({
        method,
        url: `/v1/native/project-bindings${method === 'DELETE' ? '/Laptop' : ''}`,
        headers: {
          host: HOST,
          origin: CONSOLE_ORIGIN,
          [AGENT_SERVER_TOKEN_HEADER]: token,
        },
        ...(method === 'POST'
          ? { payload }
          : method === 'DELETE'
            ? { payload: { name: 'Laptop' } }
            : {}),
      });
      expect(response.statusCode).toBe(403);
    }
  });

  it('validates the accessible project, persists in the base store, and removes registration only', async () => {
    const { app, store, source, payload } = await setup();
    const saved = await app.inject({
      method: 'POST',
      url: '/v1/native/project-bindings',
      headers,
      payload,
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      name: 'Laptop',
      apiUrl: 'https://api.example',
      readiness: { ready: true },
    });
    const stored = await readProjectConfig(join(store.root, 'projects.json'));
    expect(stored.bindings).toHaveLength(1);
    const listed = await app.inject({
      method: 'GET',
      url: '/v1/native/project-bindings',
      headers,
    });
    expect(listed.json<{ locations: unknown[] }>().locations).toHaveLength(1);
    const removed = await app.inject({
      method: 'DELETE',
      url: '/v1/native/project-bindings/Laptop',
      headers,
    });
    expect(removed.statusCode).toBe(200);
    expect((await stat(source)).isDirectory()).toBe(true);
  });

  it('rejects unavailable projects and diaries outside the selected team', async () => {
    const { app, payload } = await setup();
    for (const override of [
      { projectId: 'foreign' },
      { diaryId: 'foreign-diary' },
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/native/project-bindings',
        headers,
        payload: { ...payload, ...override },
      });
      expect(response.statusCode).toBe(400);
    }
  });
});
