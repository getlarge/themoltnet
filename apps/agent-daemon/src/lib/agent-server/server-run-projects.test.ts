import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';

import { readProjectConfig, updateProjectConfig } from '@themoltnet/sdk/node';
import { afterEach, describe, expect, it } from 'vitest';

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
  await mkdir(join(f.store.root, 'source'));
  const source = await realpath(join(f.store.root, 'source'));
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
    expect(child.args).toContain('--state-dir');
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
    expect(f.spawned[0].args).toContain('--general');
    expect(f.spawned[0].options.cwd).toBe(
      await realpath(join(f.store.runDir(run.id), 'workspace')),
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
});

it('resolves bindings from the machine store while run state uses a connection directory', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'project-base-')));
  const nativeGrant = new NativeGrantService();
  nativeGrant.grantNative('run-token');
  const f = await fixture({ nativeGrant, projectRoot: root });
  registerCleanup(() => rm(root, { recursive: true, force: true }));
  activateManaged(f.store);
  const source = join(root, 'source');
  await mkdir(source);
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
