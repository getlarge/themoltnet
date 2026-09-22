import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MoltNetError } from '@themoltnet/sdk';
import { readProjectConfig } from '@themoltnet/sdk/node';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CatalogueAgentPort } from './catalogue.js';
import {
  NATIVE_CLIENT_ORIGIN,
  NativeGrantService,
} from './native-grant-service.js';
import { AGENT_SERVER_TOKEN_HEADER } from './server.js';
import {
  activateManaged,
  cleanupAll,
  fixture,
  HOST,
  registerCleanup,
} from './server-test-harness.js';

afterEach(cleanupAll);
const project = {
  id: 'project',
  teamId: 'team',
  name: 'Project',
  description: null,
  defaultDiaryId: 'diary',
  archived: false,
};
function catalogueAgent() {
  return {
    teamIds: ['team', 'other-team'],
    lastVerified: () => undefined,
    readTeam: vi.fn(async (teamId: string) => ({
      team: { id: teamId, name: 'Team' },
      diaries: [{ id: 'diary', teamId, name: 'Diary' }],
      profiles: [],
      credential: {
        keyId: 'key',
        verifiedAt: '2026-09-20T12:00:00Z',
        scopes: ['team:read'],
      },
    })),
    readProjects: vi.fn(async () => ({ items: [project], truncated: false })),
    readProject: vi.fn(async (_teamId: string, projectId: string) =>
      projectId === project.id ? project : null,
    ),
  } satisfies CatalogueAgentPort;
}
async function setup(options: Parameters<typeof fixture>[0] = {}) {
  const nativeGrant = new NativeGrantService();
  nativeGrant.grantNative('binding-token');
  const port = catalogueAgent();
  const result = await fixture({
    ...options,
    nativeGrant,
    catalogueAgentFor: async () => port,
  });
  activateManaged(result.store);
  // A user's folder: outside the store, which locations may not use.
  const source = await realpath(await mkdtemp(join(tmpdir(), 'location-')));
  registerCleanup(() => rm(source, { recursive: true, force: true }));
  return {
    ...result,
    port,
    source,
    payload: {
      identity: 'course-bot',
      teamId: 'team',
      projectId: 'project',
      source,
      strategy: 'existing',
      default: true,
    } as Record<string, unknown>,
  };
}
const headers = {
  host: HOST,
  origin: NATIVE_CLIENT_ORIGIN,
  [AGENT_SERVER_TOKEN_HEADER]: 'binding-token',
};
const LOCATIONS = '/v1/native/project-locations';

describe('native project location administration', () => {
  it('validates the accessible project, persists in the base store, and removes registration only', async () => {
    const { app, store, source, payload, port } = await setup();
    const saved = await app.inject({
      method: 'PUT',
      url: `${LOCATIONS}/Laptop`,
      headers,
      payload,
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      name: 'Laptop',
      apiUrl: 'https://api.example',
      readiness: { ready: true },
    });
    // Only the target team is consulted; the other indexed team is untouched.
    expect(port.readTeam.mock.calls).toEqual([
      ['team', expect.any(AbortSignal)],
    ]);
    expect(port.readProjects).not.toHaveBeenCalled();
    const stored = await readProjectConfig(join(store.root, 'projects.json'));
    expect(stored.bindings).toHaveLength(1);
    const listed = await app.inject({
      method: 'GET',
      url: LOCATIONS,
      headers,
    });
    expect(listed.json<{ locations: unknown[] }>().locations).toHaveLength(1);
    const removed = await app.inject({
      method: 'DELETE',
      url: `${LOCATIONS}/Laptop`,
      headers,
    });
    expect(removed.statusCode).toBe(200);
    expect((await stat(source)).isDirectory()).toBe(true);
    const missing = await app.inject({
      method: 'DELETE',
      url: `${LOCATIONS}/Laptop`,
      headers,
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ code: 'location_not_found' });
  });

  it.each([
    [{ projectId: 'foreign' }, 'project_unavailable'],
    [{ teamId: 'unindexed-team' }, 'project_unavailable'],
    [{ diaryId: 'foreign-diary' }, 'diary_unavailable'],
  ])('rejects %o outside the selected team as %s', async (override, code) => {
    const { app, payload } = await setup();
    const response = await app.inject({
      method: 'PUT',
      url: `${LOCATIONS}/Laptop`,
      headers,
      payload: { ...payload, ...override },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code });
  });

  it('rejects hooks, unknown fields and unsupported strategies at the schema', async () => {
    const { app, payload, store } = await setup();
    for (const override of [
      {
        hooks: {
          beforeRun: { command: 'sh', args: ['-c', 'id'], timeoutMs: 1000 },
        },
      },
      { apiUrl: 'https://elsewhere.example' },
      { strategy: 'isolated-directory' },
    ]) {
      const response = await app.inject({
        method: 'PUT',
        url: `${LOCATIONS}/Laptop`,
        headers,
        payload: { ...payload, ...override },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: 'invalid_location' });
    }
    await expect(stat(join(store.root, 'projects.json'))).rejects.toMatchObject(
      { code: 'ENOENT' },
    );
  });

  it('refuses an identity whose activation points at another server', async () => {
    const { app, payload, store } = await setup();
    const config = store.readAgentConfig('course-bot')!;
    const activation = store.readActivation('course-bot')!;
    store.writeAgentConfig('course-bot', {
      ...config,
      endpoints: { ...config.endpoints, api: 'https://other.example' },
    });
    store.writeActivation({ ...activation, apiUrl: 'https://other.example' });

    const response = await app.inject({
      method: 'PUT',
      url: `${LOCATIONS}/Laptop`,
      headers,
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'endpoint_mismatch' });
  });

  it('reports a transient server failure as retryable, not as missing access', async () => {
    const { app, payload, port } = await setup();
    port.readProject.mockRejectedValueOnce(new Error('socket hang up'));

    const transient = await app.inject({
      method: 'PUT',
      url: `${LOCATIONS}/Laptop`,
      headers,
      payload,
    });
    expect(transient.statusCode).toBe(503);
    expect(transient.json()).toMatchObject({
      code: 'project_check_unavailable',
    });

    port.readProject.mockRejectedValueOnce(
      new MoltNetError('Forbidden', { code: 'FORBIDDEN', statusCode: 403 }),
    );
    const forbidden = await app.inject({
      method: 'PUT',
      url: `${LOCATIONS}/Laptop`,
      headers,
      payload,
    });
    expect(forbidden.statusCode).toBe(400);
    expect(forbidden.json()).toMatchObject({ code: 'project_unavailable' });
  });

  it('stops a slow check at the save deadline, before Desktop gives up, and writes nothing', async () => {
    const { app, payload, port, store } = await setup({
      projectSaveTimeoutMs: 50,
    });
    let received: AbortSignal | undefined;
    port.readProject.mockImplementationOnce(
      (_teamId: string, _projectId: string, signal?: AbortSignal) => {
        received = signal;
        return new Promise<never>(() => {
          // Never settles: only the save deadline ends this check.
        });
      },
    );

    const response = await app.inject({
      method: 'PUT',
      url: `${LOCATIONS}/Laptop`,
      headers,
      payload,
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      code: 'project_check_unavailable',
    });
    expect(received?.aborted).toBe(true);
    await expect(stat(join(store.root, 'projects.json'))).rejects.toMatchObject(
      { code: 'ENOENT' },
    );
  });

  it('refuses location administration without the connection store', async () => {
    const { app } = await setup({ withoutConnectionSettings: true });

    const response = await app.inject({
      method: 'GET',
      url: LOCATIONS,
      headers,
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: 'locations_unavailable' });
  });

  it('reports an invalid stored file as a server fault without its path', async () => {
    const { app, store } = await setup();
    await writeFile(
      join(store.root, 'projects.json'),
      JSON.stringify({ version: 1, bindings: [{ name: 1 }] }),
      { mode: 0o600 },
    );

    const response = await app.inject({
      method: 'GET',
      url: LOCATIONS,
      headers,
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ code: 'config_invalid' });
    expect(response.body).not.toContain(store.root);
  });

  it('refuses a folder inside the configuration store before running git', async () => {
    const { app, payload, store } = await setup();
    const inside = join(store.root, 'identities');
    await mkdir(inside, { recursive: true });

    const response = await app.inject({
      method: 'PUT',
      url: `${LOCATIONS}/Laptop`,
      headers,
      payload: { ...payload, source: inside, strategy: 'git-worktree' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'folder_protected' });
  });
});
