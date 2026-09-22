import { invoke } from '@tauri-apps/api/core';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { desktopBridge } from '../bridge.js';
import {
  catalogue,
  preset,
  running,
  status,
} from './composer-fixtures.test-support.js';
import { DesktopRunCenter } from './DesktopRunCenter.js';
import { runCenterActions } from './run-center-bridge.js';
import type { RunCenterAppProps } from './RunCenterApp.js';

const capture = vi.hoisted(() => ({ props: null as RunCenterAppProps | null }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('./RunCenterApp.js', () => ({
  RunCenterApp: (props: RunCenterAppProps) => {
    capture.props = props;
    return null;
  },
}));
const current = () => {
  if (!capture.props) throw new Error('Run center has not rendered');
  return capture.props;
};
beforeEach(() => {
  vi.useFakeTimers();
  capture.props = null;
  localStorage.clear();
  vi.spyOn(desktopBridge, 'status').mockResolvedValue(running);
  vi.spyOn(desktopBridge, 'subscribe').mockResolvedValue(() => {});
  vi.mocked(invoke).mockImplementation((command) => {
    if (command === 'desktop_control_status') return Promise.resolve(status);
    if (command === 'desktop_catalogue') return Promise.resolve(catalogue);
    if (command === 'desktop_preset_storage_scope')
      return Promise.resolve({ storageScope: '' });
    return Promise.resolve(false);
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
async function mount() {
  await act(async () => {
    render(<DesktopRunCenter />);
  });
}

describe('run center state ownership', () => {
  it('returns a successful save and keeps its ID even when a later storage read would fail', async () => {
    await mount();
    vi.spyOn(runCenterActions, 'savePreset').mockResolvedValue(preset);
    vi.mocked(invoke).mockRejectedValue(new Error('Storage read unavailable'));
    await act(async () => {
      expect(
        await current().actions.savePreset({ ...preset, id: null }),
      ).toEqual(preset);
    });
    expect(current().data.presets).toEqual([preset]);
  });
  it('retains the last good catalogue without announcing loading on background failure', async () => {
    await mount();
    expect(current().data.catalogue).toEqual(catalogue);
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === 'desktop_control_status') return Promise.resolve(status);
      if (command === 'desktop_catalogue')
        return Promise.reject(new Error('Temporary outage'));
      return Promise.resolve(false);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(65000);
    });
    expect(current().data.catalogue).toEqual(catalogue);
    expect(current().data.catalogueLoading).toBe(false);
    expect(current().data.catalogueError).toBeTruthy();
  });
});
