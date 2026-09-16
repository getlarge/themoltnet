import { invoke } from '@tauri-apps/api/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { desktopBridge } from './bridge.js';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(),
}));

describe('desktop native bridge', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses distinct native commands for explicit server ownership', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);

    await desktopBridge.start();
    await desktopBridge.stop();

    expect(invoke).toHaveBeenNthCalledWith(1, 'start_agent_server');
    expect(invoke).toHaveBeenNthCalledWith(2, 'stop_agent_server');
  });

  it('requests the structured desktop update result', async () => {
    const result = {
      availableVersion: null,
      message: 'Signed builds only.',
    };
    vi.mocked(invoke).mockResolvedValue(result);

    await expect(desktopBridge.checkDesktopUpdate()).resolves.toEqual(result);
    expect(invoke).toHaveBeenCalledWith('check_for_desktop_update');
  });
});
