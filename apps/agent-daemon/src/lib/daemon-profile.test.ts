import type { Agent } from '@themoltnet/sdk';
import { describe, expect, it, vi } from 'vitest';

import {
  DaemonProfilePrerequisiteError,
  resolveDaemonProfile,
  resolveProfileWarmSessionTtlSec,
  validateDaemonProfilePrerequisites,
} from './daemon-profile.js';

const profile = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  name: 'github-linear',
  teamId: 'team-1',
  provider: 'anthropic',
  model: 'claude-sonnet-4-5',
  leaseTtlSec: 900,
  heartbeatIntervalMs: 15_000,
  maxBatchSize: 10,
  sessionTtlSec: 600,
  workspaceTtlSec: 300,
  requiredEnv: [],
  requiredTools: [],
  sandbox: {
    snapshot: { allowedHosts: ['api.github.com'] },
    resources: { cpus: 4, memory: '4G' },
  },
};

function makeAgent(overrides: {
  get?: Agent['daemonProfiles']['get'];
  list?: Agent['daemonProfiles']['list'];
}): Agent {
  return {
    daemonProfiles: {
      get: overrides.get ?? vi.fn(),
      list: overrides.list ?? vi.fn(),
    },
  } as unknown as Agent;
}

describe('resolveDaemonProfile', () => {
  it('fetches a UUID profile directly', async () => {
    const get = vi.fn().mockResolvedValue(profile);
    const agent = makeAgent({ get });

    const result = await resolveDaemonProfile({
      agent,
      profile: profile.id,
      teamId: 'team-1',
      cwd: '/tmp/workspace',
    });

    expect(get).toHaveBeenCalledWith(profile.id);
    expect(result).toEqual({
      id: profile.id,
      name: profile.name,
      teamId: 'team-1',
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      leaseTtlSec: 900,
      heartbeatIntervalMs: 15_000,
      maxBatchSize: 10,
      sessionTtlSec: 600,
      workspaceTtlSec: 300,
      requiredEnv: [],
      requiredTools: [],
      sandboxConfig: profile.sandbox,
      mountPath: '/tmp/workspace',
      source: `daemon-profile:${profile.id}`,
    });
  });

  it('resolves a unique profile name within a team', async () => {
    const list = vi.fn().mockResolvedValue({ items: [profile] });
    const agent = makeAgent({ list });

    const result = await resolveDaemonProfile({
      agent,
      profile: 'github-linear',
      teamId: 'team-1',
      cwd: '/tmp/workspace',
    });

    expect(list).toHaveBeenCalledWith('team-1');
    expect(result.id).toBe(profile.id);
  });

  it('rejects profile names without a team-scoped list', async () => {
    await expect(
      resolveDaemonProfile({
        agent: makeAgent({}),
        profile: 'github-linear',
        cwd: '/tmp/workspace',
      }),
    ).rejects.toThrow(/requires --team/);
  });

  it('rejects ambiguous profile names', async () => {
    const list = vi.fn().mockResolvedValue({
      items: [
        profile,
        { ...profile, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
      ],
    });

    await expect(
      resolveDaemonProfile({
        agent: makeAgent({ list }),
        profile: 'github-linear',
        teamId: 'team-1',
        cwd: '/tmp/workspace',
      }),
    ).rejects.toThrow(/ambiguous/);
  });

  it('rejects a profile from another team', async () => {
    const get = vi.fn().mockResolvedValue({ ...profile, teamId: 'team-2' });

    await expect(
      resolveDaemonProfile({
        agent: makeAgent({ get }),
        profile: profile.id,
        teamId: 'team-1',
        cwd: '/tmp/workspace',
      }),
    ).rejects.toThrow(/belongs to team team-2/);
  });

  it('uses the smaller session/workspace TTL for local warm-slot retention', () => {
    expect(resolveProfileWarmSessionTtlSec(profile)).toBe(300);
    expect(
      resolveProfileWarmSessionTtlSec({
        ...profile,
        sessionTtlSec: 120,
        workspaceTtlSec: 600,
      }),
    ).toBe(120);
  });

  it('accepts satisfied profile prerequisites', () => {
    validateDaemonProfilePrerequisites(
      {
        name: 'github-linear',
        requiredEnv: ['GITHUB_TOKEN'],
        requiredTools: [process.execPath],
      },
      { GITHUB_TOKEN: 'token' },
      '/usr/bin:/bin',
    );
  });

  it('rejects missing profile env and tool prerequisites before claiming', () => {
    expect(() =>
      validateDaemonProfilePrerequisites(
        {
          name: 'github-linear',
          requiredEnv: ['LINEAR_API_KEY', 'GITHUB_TOKEN'],
          requiredTools: ['definitely-not-installed-moltnet-tool'],
        },
        { GITHUB_TOKEN: 'token' },
        '/usr/bin:/bin',
      ),
    ).toThrow(DaemonProfilePrerequisiteError);
    expect(() =>
      validateDaemonProfilePrerequisites(
        {
          name: 'github-linear',
          requiredEnv: ['LINEAR_API_KEY'],
          requiredTools: ['definitely-not-installed-moltnet-tool'],
        },
        {},
        '/usr/bin:/bin',
      ),
    ).toThrow(/missing env: LINEAR_API_KEY; missing tools/);
  });
});
