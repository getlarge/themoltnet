import type * as SandboxGondolin from '@themoltnet/sandbox-gondolin';
import type { VmConfig } from '@themoltnet/sandbox-gondolin';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { resumeVm } from './vm.js';

const resumeSandboxVm = vi.fn(async (config: VmConfig) => ({ config }));
vi.mock('@themoltnet/sandbox-gondolin', async (importOriginal) => ({
  ...(await importOriginal<typeof SandboxGondolin>()),
  resumeVm: (config: VmConfig) => resumeSandboxVm(config),
}));

afterEach(() => {
  resumeSandboxVm.mockClear();
});

describe('resumeVm (Pi wrapper)', () => {
  it('passes the config straight through without projecting provider auth', async () => {
    await resumeVm({ checkpointPath: '/cp', agentName: 'a', mountPath: '/ws' });
    expect(resumeSandboxVm).toHaveBeenCalledTimes(1);
    const passed = resumeSandboxVm.mock.calls[0]?.[0] as unknown as Record<
      string,
      unknown
    >;
    expect(passed).toMatchObject({
      checkpointPath: '/cp',
      agentName: 'a',
      mountPath: '/ws',
    });
    // The Pi session + model calls run host-side; the guest gets no provider auth.
    expect('providerAuth' in passed).toBe(false);
  });
});
