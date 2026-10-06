import * as pi from '@themoltnet/pi-runtime';
import { Type } from 'typebox';
import { afterEach, expect, it, vi } from 'vitest';

import { createPiDaemonAdapter } from './pi.js';

afterEach(() => vi.restoreAllMocks());

it('attests the same capability declarations it passes to the Durable executor', async () => {
  const create = vi
    .spyOn(pi, 'createGondolinDurableTaskExecutor')
    .mockReturnValue(vi.fn());
  const resolveSecret = vi.fn().mockResolvedValue('runtime-only-value');
  const secret = pi.definePiBrokeredHttpSecret({
    id: 'github',
    guestEnv: 'GH_TOKEN',
    hosts: ['api.github.com'],
    resolve: resolveSecret,
  });
  const template = {
    id: 'vm',
    version: '1',
    checkpointPath: '/checkpoint',
    fingerprint: 'fingerprint',
    guestAssetBuildId: 'guest',
    executables: [],
    resumeCommands: [],
  };
  const adapter = createPiDaemonAdapter(
    pi.definePiRuntime({
      runtimeKind: 'gondolin_pi',
      id: 'durable',
      version: '1',
      vm: {
        kind: 'gondolin',
        id: 'vm',
        version: '1',
        executables: [],
        resumeCommands: [],
        resolve: vi.fn().mockResolvedValue(template),
      },
      tools: [
        pi.definePiTool({
          name: 'project_lookup',
          label: 'Lookup',
          description: 'Lookup project',
          parameters: Type.Object({}),
          execute: vi.fn(),
        }),
      ],
      extensions: [
        pi.definePiExtension({ extension: { name: 'team-native', tools: [] } }),
      ],
      hostCapabilities: [pi.agentSigningCapability],
      brokeredHttpSecrets: [secret],
    }),
  );
  const prepared = await adapter.prepare({
    profile: {
      id: 'profile',
      definitionCid: 'profile-cid',
      models: { generation: { provider: 'p', model: 'm' } },
      runtimeKind: 'gondolin_pi',
      sandboxConfig: undefined,
    },
  });
  prepared.createTaskExecutor({ agentName: 'a', provider: 'p', model: 'm' });
  expect(prepared.tools).toEqual([
    ...pi.GONDOLIN_TOOL_NAMES,
    'subagent',
    ...pi.MOLTNET_TOOL_NAMES,
    'project_lookup',
  ]);
  expect(prepared.manifest.hostCapabilities).toEqual([
    expect.objectContaining({ name: 'agent-signing' }),
  ]);
  expect(prepared.runtimeKind).toBe('gondolin_pi');
  expect(prepared.manifest).toMatchObject({
    durability: { format: 'pi-durable.v1' },
  });
  expect(create).toHaveBeenCalledOnce();
  const config = create.mock.calls[0][0];
  expect(config.runtimeDefinition?.hostCapabilities).toEqual([
    pi.agentSigningCapability,
  ]);
  expect(config.runtimeDefinition?.brokeredHttpSecrets).toEqual([secret]);
  expect(config.template).toEqual(template);
  expect(resolveSecret).not.toHaveBeenCalled();
  expect(JSON.stringify(prepared.manifest)).not.toContain('runtime-only-value');
});

it('rejects unsupported Durable extensions before resolving a VM instead of dropping them', async () => {
  const resolve = vi.fn();
  const adapter = createPiDaemonAdapter(
    pi.definePiRuntime({
      id: 'durable',
      version: '1',
      runtimeKind: 'gondolin_pi',
      vm: {
        kind: 'gondolin',
        id: 'vm',
        version: '1',
        executables: [],
        resumeCommands: [],
        resolve,
      },
      extensions: [pi.piCodemode()],
    }),
  );
  await expect(
    adapter.prepare({
      profile: {
        id: 'profile',
        definitionCid: 'profile-cid',
        models: { generation: { provider: 'p', model: 'm' } },
        runtimeKind: 'gondolin_pi',
        sandboxConfig: undefined,
      },
    }),
  ).rejects.toThrow('Migrate coding-agent session extensions');
  expect(resolve).not.toHaveBeenCalled();
});
