import type { ResolvedRuntimeProfile } from '@themoltnet/agent-runtime';
import type { Agent } from '@themoltnet/sdk';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./executor-attestation.js', () => ({
  attestPreparedRuntime: (prepared: object) => ({
    ...prepared,
    attestor: { registration: vi.fn() },
  }),
}));

import type { DaemonRuntimeAdapter } from '../runtime.js';
import { prepareRuntimeProfile } from './prepare-runtime-profile.js';

const profile = {
  id: 'dddddddd-0000-4000-8000-000000000004',
  name: 'reviewer',
  teamId: 'bbbbbbbb-0000-4000-8000-000000000002',
  runtimeKind: 'gondolin_pi',
  definitionCid: 'bafyprofile',
  provider: 'anthropic',
  model: 'claude-sonnet-4-5',
  thinkingLevel: null,
  temperature: null,
  topP: null,
  topK: null,
  maxOutputTokens: null,
  maxTurns: 20,
  maxBashTimeouts: 3,
  defaultWorkspaceMode: null,
  allowedWorkspaceModes: ['none'],
  requiredEnv: [],
  requiredTools: [],
  requiredExecutables: [],
  toolEnforcement: 'watch',
  context: [],
  sandboxConfig: {},
  mountPath: '/tmp/profile',
  source: 'runtime-profile:dddddddd-0000-4000-8000-000000000004',
} satisfies ResolvedRuntimeProfile;

function adapter(
  overrides: {
    runtimeKind?: string;
    tools?: string[];
    executables?: string[];
  } = {},
): DaemonRuntimeAdapter {
  return {
    runtimeKind: overrides.runtimeKind ?? 'gondolin_pi',
    prepare: vi.fn().mockResolvedValue({
      runtimeKind: overrides.runtimeKind ?? 'gondolin_pi',
      manifest: {},
      tools: overrides.tools ?? [],
      executables: overrides.executables ?? [],
      createTaskExecutor: vi.fn(),
    }),
  };
}

function prepare(
  runtimeAdapter: DaemonRuntimeAdapter,
  selectedProfile: ResolvedRuntimeProfile,
  prerequisiteEnv: NodeJS.ProcessEnv = {},
) {
  return prepareRuntimeProfile({
    agent: {
      tasks: { registerExecutorManifest: vi.fn() },
    } as unknown as Agent,
    agentName: 'legreffier',
    profile: selectedProfile,
    prerequisiteEnv,
    runtimeAdapter,
    runtimeInstanceId: 'worker-1',
    signingPrivateKey: 'unused-by-mock',
    slotRegistry: {} as never,
    runtimeSessionStore: {} as never,
    sourceAttemptResolver: {} as never,
    warmRetentionSec: 1800,
  });
}

describe('prepareRuntimeProfile', () => {
  it('rejects a runtime adapter mismatch before preparation', async () => {
    const runtimeAdapter = adapter({ runtimeKind: 'other_runtime' });

    await expect(prepare(runtimeAdapter, profile)).rejects.toThrow(
      /requires "gondolin_pi".*provides "other_runtime"/,
    );
  });

  it('rejects missing runtime prerequisites', async () => {
    await expect(
      prepare(adapter(), {
        ...profile,
        requiredEnv: ['REQUIRED_TOKEN'],
        requiredTools: ['github.pr.create'],
        requiredExecutables: ['git'],
      }),
    ).rejects.toThrow(
      /missing env: REQUIRED_TOKEN.*missing tools: github\.pr\.create.*missing guest executables: git/,
    );
  });

  it('rejects reserved environment names at the guest boundary', async () => {
    await expect(
      prepare(
        adapter(),
        { ...profile, requiredEnv: ['MOLTNET_PRIVATE_KEY'] },
        { MOLTNET_PRIVATE_KEY: 'present' },
      ),
    ).rejects.toThrow(/refuses runtime-controlled environment variables/);
  });
});
