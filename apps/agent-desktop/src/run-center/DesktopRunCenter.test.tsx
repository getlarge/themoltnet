import { invoke } from '@tauri-apps/api/core';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { desktopBridge } from '../bridge.js';
import { createTestWrapper } from '../test-query-client.js';
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
    const Wrapper = createTestWrapper();
    render(
      <Wrapper>
        <DesktopRunCenter />
      </Wrapper>,
    );
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
    // Let the cache write flush into a render before reading the props.
    await act(async () => {
      await Promise.resolve();
    });
    expect(current().data.presets).toEqual([preset]);
  });
  it('reads the catalogue once on mount', async () => {
    await mount();
    // The status poll used to invalidate the catalogue on every pass, which
    // stacked a second read on top of the cache's own first fetch.
    expect(
      vi.mocked(invoke).mock.calls.filter(([c]) => c === 'desktop_catalogue')
        .length,
    ).toBe(1);
  });
  it('keeps polling the catalogue it owns on its own interval', async () => {
    await mount();
    const reads = () =>
      vi.mocked(invoke).mock.calls.filter(([c]) => c === 'desktop_catalogue')
        .length;
    expect(reads()).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(65000);
    });
    // The run center is the single polling owner for its identity; the
    // retention and loading-flag behaviour it used to prop-drill is pinned in
    // useCatalogue.test.tsx, against the hook that now owns it.
    expect(reads()).toBeGreaterThan(1);
  });
  it('keeps view actions stable across status polls', async () => {
    await mount();
    const actions = current().actions;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5500);
    });
    // RunDetail subscribes to logs and TeamsView loads operator teams using
    // this object as an effect dependency. Polling must not restart either.
    expect(current().actions).toBe(actions);
  });
});
