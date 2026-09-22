import { mkdtemp, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';

import { readProjectConfig, updateProjectConfig } from '@themoltnet/sdk/node';
import { afterEach, describe, expect, it } from 'vitest';

import {
  NATIVE_CLIENT_ORIGIN,
  NativeGrantService,
} from './native-grant-service.js';
import { writeRunSnapshot } from './runs.js';
import { AGENT_SERVER_TOKEN_HEADER } from './server.js';
import {
  activateManaged,
  authorize,
  cleanupAll,
  CONSOLE_ORIGIN,
  fixture,
  HOST,
  registerCleanup,
} from './server-test-harness.js';
import type { RunRecord } from './store.js';

afterEach(cleanupAll);
const spec = {
  agent: 'course-bot',
  teamId: 'team-1',
  profiles: ['profile'],
  taskTypes: ['freeform'],
  mode: 'poll',
};
const nativeHeaders = {
  host: HOST,
  origin: NATIVE_CLIENT_ORIGIN,
  [AGENT_SERVER_TOKEN_HEADER]: 'run-token',
};
async function setup() {
  const nativeGrant = new NativeGrantService();
  nativeGrant.grantNative('run-token');
  const f = await fixture({ nativeGrant });
  activateManaged(f.store);
  // A user's folder lives outside the MoltNet store, which workers may not use.
  const source = await realpath(await mkdtemp(join(tmpdir(), 'run-source-')));
  registerCleanup(() => rm(source, { recursive: true, force: true }));
  await updateProjectConfig(join(f.store.root, 'projects.json'), (config) => {
    config.bindings.push({
      name: 'Laptop',
      apiUrl: 'https://api.example',
      teamId: 'team-1',
      projectId: 'project',
      source,
      strategy: 'existing',
      default: true,
    });
  });
  return { ...f, source };
}

describe('native managed project runs', () => {
  it('captures the selection and sends an absolute immutable config across HOME isolation', async () => {
    const f = await setup();
    const response = await f.app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: nativeHeaders,
      payload: { ...spec, projectId: 'project', binding: 'Laptop' },
    });
    expect(response.statusCode, response.body).toBe(201);
    const run = response.json<RunRecord>();
    expect(run.workspace).toMatchObject({
      projectId: 'project',
      binding: 'Laptop',
      source: f.source,
      strategy: 'existing',
    });
    const child = f.spawned[0];
    const configPath = child.args[child.args.indexOf('--config-file') + 1];
    expect(isAbsolute(configPath)).toBe(true);
    expect(configPath).not.toBe(join(f.store.root, 'projects.json'));
    expect(child.options.cwd).toBe(f.source);
    expect(child.options.env.HOME).not.toBe(f.source);
    expect(child.args).toContain('--binding');
    // Stable per agent and location, so retries find their state.
    const stateDir = child.args[child.args.indexOf('--state-dir') + 1];
    expect(stateDir).toBe(
      join(f.store.root, 'run-state', 'course-bot', 'location-Laptop'),
    );
    expect((await stat(configPath)).mode & 0o777).toBe(0o600);
    // The record keeps the request; resolved values live in `workspace`.
    expect(run).toMatchObject({ projectId: 'project', binding: 'Laptop' });
    expect(run).not.toHaveProperty('diaryId');
    expect(run.workspace).not.toHaveProperty('configPath');
    await updateProjectConfig(join(f.store.root, 'projects.json'), (config) => {
      config.bindings[0].strategy = 'none';
      delete config.bindings[0].source;
    });
    expect((await readProjectConfig(configPath)).bindings[0].source).toBe(
      f.source,
    );
    expect(f.store.readRun(run.id)?.workspace?.source).toBe(f.source);
  });

  it('passes General explicitly and chooses an execution directory separate from state', async () => {
    const f = await setup();
    const response = await f.app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: nativeHeaders,
      payload: { ...spec, projectId: null },
    });
    expect(response.statusCode, response.body).toBe(201);
    const run = response.json<RunRecord>();
    expect(run.workspace?.projectId).toBeNull();
    expect(run.workspace).not.toHaveProperty('source');
    expect(f.spawned[0].args).toContain('--general');
    expect(await realpath(String(f.spawned[0].options.cwd))).toBe(
      await realpath(join(f.store.runDir(run.id), 'workspace')),
    );
    const stateDir =
      f.spawned[0].args[f.spawned[0].args.indexOf('--state-dir') + 1];
    expect(stateDir).toBe(
      join(f.store.root, 'run-state', 'course-bot', 'general'),
    );
  });

  it('denies browser requests for project locations or host folder overrides', async () => {
    const f = await setup();
    const token = await authorize(f.app);
    for (const selection of [
      { projectId: 'project' },
      { binding: 'Laptop' },
      { source: f.source },
      { workspaceStrategy: 'existing' },
    ]) {
      const response = await f.app.inject({
        method: 'POST',
        url: '/v1/runs',
        headers: {
          host: HOST,
          origin: CONSOLE_ORIGIN,
          [AGENT_SERVER_TOKEN_HEADER]: token,
        },
        payload: { ...spec, ...selection },
      });
      expect(response.statusCode).toBe(403);
    }
    expect(f.spawned).toHaveLength(0);
  });

  it('keeps pre-selection behaviour when no project field is sent', async () => {
    const f = await setup();
    const response = await f.app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: nativeHeaders,
      payload: spec,
    });
    expect(response.statusCode, response.body).toBe(201);
    expect(response.json()).not.toHaveProperty('workspace');
    expect(f.spawned[0].args).not.toContain('--config-file');
    expect(f.spawned[0].args).not.toContain('--state-dir');
  });

  it('shows browsers the location and project, never local paths', async () => {
    const f = await setup();
    await f.app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: nativeHeaders,
      payload: { ...spec, projectId: 'project', binding: 'Laptop' },
    });
    const token = await authorize(f.app);
    const listed = await f.app.inject({
      method: 'GET',
      url: '/v1/runs',
      headers: {
        host: HOST,
        origin: CONSOLE_ORIGIN,
        [AGENT_SERVER_TOKEN_HEADER]: token,
      },
    });
    const [run] = listed.json<RunRecord[]>();
    expect(run.workspace).toMatchObject({
      projectId: 'project',
      binding: 'Laptop',
    });
    expect(run.workspace).not.toHaveProperty('source');
    expect(listed.body).not.toContain(f.source);
    expect(listed.body).not.toContain('projects.json');
  });

  it('lets browsers start General work', async () => {
    const f = await setup();
    const token = await authorize(f.app);
    const response = await f.app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: {
        host: HOST,
        origin: CONSOLE_ORIGIN,
        [AGENT_SERVER_TOKEN_HEADER]: token,
      },
      payload: { ...spec, projectId: null },
    });
    expect(response.statusCode, response.body).toBe(201);
    expect(response.body).not.toContain('projects.json');
  });
});

it('creates each run snapshot exclusively and owner-only', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'run-snapshot-'));
  registerCleanup(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'projects.json');
  writeRunSnapshot(path, { version: 1, bindings: [] });
  expect((await stat(path)).mode & 0o777).toBe(0o600);
  expect(() => writeRunSnapshot(path, { version: 1, bindings: [] })).toThrow(
    /EEXIST/,
  );
});

it('resolves bindings from the machine store while run state uses a connection directory', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'project-base-')));
  const nativeGrant = new NativeGrantService();
  nativeGrant.grantNative('run-token');
  const f = await fixture({ nativeGrant, projectRoot: root });
  registerCleanup(() => rm(root, { recursive: true, force: true }));
  activateManaged(f.store);
  const source = await realpath(await mkdtemp(join(tmpdir(), 'base-source-')));
  registerCleanup(() => rm(source, { recursive: true, force: true }));
  await updateProjectConfig(join(root, 'projects.json'), (config) => {
    config.bindings.push({
      name: 'Base location',
      apiUrl: 'https://api.example',
      teamId: 'team-1',
      projectId: 'project',
      source,
      strategy: 'existing',
    });
  });
  const response = await f.app.inject({
    method: 'POST',
    url: '/v1/runs',
    headers: nativeHeaders,
    payload: { ...spec, projectId: 'project', binding: 'Base location' },
  });
  expect(response.statusCode, response.body).toBe(201);
  expect(response.json<RunRecord>().workspace?.source).toBe(source);
  expect(f.spawned[0].options.env.HOME).toContain(f.store.root);
});
