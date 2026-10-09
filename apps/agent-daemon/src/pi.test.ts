import { validateRuntimeProfilePrerequisites } from '@themoltnet/agent-runtime';
import { GONDOLIN_BASE_EXECUTABLES } from '@themoltnet/pi-runtime';
import { describe, expect, it, vi } from 'vitest';

import { createPiDaemonAdapter, defaultPiRuntimeDefinition } from './pi.js';

describe('default Pi daemon runtime', () => {
  it('advertises the commands guaranteed by the base Gondolin snapshot', () => {
    expect(defaultPiRuntimeDefinition.vm.executables).toEqual(
      GONDOLIN_BASE_EXECUTABLES,
    );
    expect(defaultPiRuntimeDefinition.vm.executables).toEqual(
      expect.arrayContaining(['git', 'gh']),
    );
    expect(() =>
      validateRuntimeProfilePrerequisites(
        {
          name: 'github-review',
          requiredEnv: [],
          requiredTools: [],
          requiredExecutables: ['git', 'gh'],
        },
        {},
        { executables: defaultPiRuntimeDefinition.vm.executables },
      ),
    ).not.toThrow();
  });

  it('prepares a classification-only profile without resolving a VM', async () => {
    const resolve = vi.fn().mockRejectedValue(new Error('VM not needed'));
    const adapter = createPiDaemonAdapter({
      ...defaultPiRuntimeDefinition,
      vm: { ...defaultPiRuntimeDefinition.vm, resolve },
    });
    const prepared = await adapter.prepare({
      profile: {
        id: 'classifier-profile',
        definitionCid: 'bafyprofile',
        runtimeKind: 'gondolin_pi',
        models: {
          classification: { provider: 'typesafe', model: 'decisions' },
        },
        sandboxConfig: undefined,
      },
    });

    expect(resolve).not.toHaveBeenCalled();
    expect(prepared.manifest).toMatchObject({
      runtime: { sandbox: 'host' },
      classifier: { provider: 'typesafe', model: 'decisions' },
      tools: [],
      extensions: [],
      executables: [],
    });
    expect(prepared.manifest).not.toHaveProperty('vm');
    expect(prepared.tools).toEqual([]);
  });

  it('keeps Gondolin for a profile that also generates', async () => {
    const resolve = vi.fn().mockResolvedValue({
      id: 'test-vm',
      version: '1',
      checkpointPath: '/tmp/test-vm',
      fingerprint: 'bafytemplate',
      guestAssetBuildId: 'guest-build',
      executables: ['git'],
      resumeCommands: [],
    });
    const prepared = await createPiDaemonAdapter({
      ...defaultPiRuntimeDefinition,
      vm: { ...defaultPiRuntimeDefinition.vm, resolve },
    }).prepare({
      profile: {
        id: 'mixed-profile',
        definitionCid: 'bafyprofile',
        runtimeKind: 'gondolin_pi',
        models: {
          generation: { provider: 'chat', model: 'chat' },
          classification: { provider: 'typesafe', model: 'decisions' },
        },
        sandboxConfig: undefined,
      },
    });

    expect(resolve).toHaveBeenCalledOnce();
    expect(prepared.manifest).toMatchObject({
      runtime: { sandbox: 'gondolin' },
      vm: { templateFingerprint: 'bafytemplate' },
    });
    expect(prepared.tools).toContain('classify');
  });
});
