import { validateRuntimeProfilePrerequisites } from '@themoltnet/agent-runtime';
import {
  definePiExtension,
  definePiRuntime,
  GONDOLIN_BASE_EXECUTABLES,
  type PiExecutorManifest,
} from '@themoltnet/pi-runtime';
import { describe, expect, it } from 'vitest';

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

  it('preserves extension tool effects in the prepared runtime manifest', async () => {
    const runtime = definePiRuntime({
      id: 'custom-pi',
      version: '1',
      vm: {
        kind: 'gondolin',
        id: 'test-vm',
        version: '1',
        executables: ['git'],
        resumeCommands: [],
        resolve: () =>
          Promise.resolve({
            id: 'test-vm',
            version: '1',
            checkpointPath: '/tmp/test-checkpoint',
            fingerprint: 'bafkreitemplate',
            guestAssetBuildId: 'guest-build',
            executables: ['git'],
            resumeCommands: [],
          }),
      },
      extensions: [
        definePiExtension({
          id: 'review-extension',
          declaredTools: [
            {
              name: 'review_issue',
              effects: { network: ['host'] },
            },
          ],
          factory: () => undefined,
        }),
      ],
    });

    const prepared = await createPiDaemonAdapter(runtime).prepare({
      profile: {
        id: 'profile-id',
        definitionCid: 'bafkreiprofile',
        runtimeKind: 'gondolin_pi',
        sandboxConfig: undefined,
      },
    });

    expect(prepared.tools).toContain('review_issue');
    const manifest = prepared.manifest as unknown as PiExecutorManifest;
    expect(manifest.schemaVersion).toBe('moltnet:executor-manifest:v1');
    expect(manifest.tools.find(({ name }) => name === 'review_issue')).toEqual({
      name: 'review_issue',
      descriptorCid: null,
      scope: 'parent',
      effects: { network: ['host'] },
    });
    const kernelBash = manifest.tools.find(({ name }) => name === 'bash');
    expect(kernelBash).toEqual({
      name: 'bash',
      descriptorCid: null,
      scope: 'parent_and_subagents',
    });
    expect(kernelBash).not.toHaveProperty('effects');
  });
});
