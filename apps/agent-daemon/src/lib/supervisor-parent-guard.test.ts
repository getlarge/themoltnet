import { describe, expect, it, vi } from 'vitest';

import { installSupervisorParentGuard } from './supervisor-parent-guard.js';

describe('installSupervisorParentGuard', () => {
  it('terminates a supervised child when the parent IPC channel closes', () => {
    let onDisconnect: (() => void) | undefined;
    const kill = vi.fn(() => true);
    const installed = installSupervisorParentGuard({
      env: { MOLTNET_SUPERVISED_RUN: '1' },
      pid: 42,
      disconnect: vi.fn(),
      once: (_event, listener) => {
        onDisconnect = listener;
      },
      kill,
    });

    onDisconnect?.();

    expect(installed).toBe(true);
    expect(kill).toHaveBeenCalledWith(42, 'SIGTERM');
  });

  it('does not install outside a supervised IPC child', () => {
    expect(
      installSupervisorParentGuard({
        env: {},
        pid: 42,
        once: vi.fn(),
        kill: vi.fn(() => true),
      }),
    ).toBe(false);
  });

  it('terminates immediately when the IPC parent is already gone', () => {
    const kill = vi.fn(() => true);

    expect(
      installSupervisorParentGuard({
        env: { MOLTNET_SUPERVISED_RUN: '1' },
        pid: 42,
        connected: false,
        disconnect: vi.fn(),
        once: vi.fn(),
        kill,
      }),
    ).toBe(true);
    expect(kill).toHaveBeenCalledWith(42, 'SIGTERM');
  });
});
