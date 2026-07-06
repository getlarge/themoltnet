import { describe, expect, it } from 'vitest';

import runtimeProfile from '../src/nodes/runtime-profile.js';
import tasksCreate from '../src/nodes/tasks-create.js';
import { FakeRed } from './fake-red.js';
import { agentStub } from './node-test-utils.js';

describe('moltnet-runtime-profile + tasks-create routing', () => {
  /** Build a FakeRed with a fake agent, the profile node, and tasks-create. */
  function setup(agent: Record<string, unknown>) {
    const created: Record<string, unknown>[] = [];
    const a = {
      tasks: {
        create: (body: Record<string, unknown>) => {
          created.push(body);
          return Promise.resolve({ id: 't' });
        },
      },
      ...agent,
    };
    const red = new FakeRed();
    red.load(agentStub(a));
    red.load(runtimeProfile);
    red.load(tasksCreate);
    red.create('moltnet-agent', 'a1');
    return { red, created };
  }

  it('registers a guarded admin endpoint for the profile dropdown', () => {
    const red = new FakeRed();
    red.load(runtimeProfile);
    const route = red.adminRoutes.find((r) =>
      r.path.includes('moltnet-runtime-profiles'),
    );
    expect(route).toBeDefined();
    expect(route?.method).toBe('get');
    expect(route?.guarded).toBe(true);
  });

  it('config node sets allowedProfiles from its profileId', async () => {
    const { red, created } = setup({});
    red.create('moltnet-runtime-profile', 'rp1', { profileId: 'prof-x' });
    const node = red.create('moltnet-tasks-create', 'n1', {
      agent: 'a1',
      runtimeProfile: 'rp1',
    });

    await red.input(node, { payload: { input: { brief: 'go' } } });

    expect(created[0].allowedProfiles).toEqual([{ profileId: 'prof-x' }]);
  });

  it('msg.payload.allowedProfiles overrides the config node', async () => {
    const { red, created } = setup({});
    red.create('moltnet-runtime-profile', 'rp1', { profileId: 'prof-x' });
    const node = red.create('moltnet-tasks-create', 'n1', {
      agent: 'a1',
      runtimeProfile: 'rp1',
    });

    await red.input(node, {
      payload: { allowedProfiles: [{ profileId: 'pay' }] },
    });

    expect(created[0].allowedProfiles).toEqual([{ profileId: 'pay' }]);
  });

  it('leaves allowedProfiles unset when the config node has no profileId', async () => {
    const { red, created } = setup({});
    red.create('moltnet-runtime-profile', 'rp1', { profileId: '' });
    const node = red.create('moltnet-tasks-create', 'n1', {
      agent: 'a1',
      runtimeProfile: 'rp1',
    });

    await red.input(node, { payload: {} });

    expect(created[0].allowedProfiles).toBeUndefined();
  });
});
