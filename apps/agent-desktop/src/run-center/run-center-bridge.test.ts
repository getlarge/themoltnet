import { invoke } from '@tauri-apps/api/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { listPresets, runCenterActions } from './run-center-bridge.js';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

describe('native team enrollment bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('isolates presets by the native environment and preserves the default key', async () => {
    const input = {
      name: 'Repeat',
      agent: 'agent',
      teamId: 'team',
      profileIds: ['profile'],
      taskTypes: ['freeform'],
    };
    vi.mocked(invoke).mockResolvedValue({ storageScope: '' });
    await runCenterActions.savePreset(input);
    expect(localStorage.getItem('moltnet.run-presets.v1')).not.toBeNull();
    vi.mocked(invoke).mockResolvedValue({
      storageScope: '/stores/a/environments/one',
    });
    expect(await listPresets()).toEqual([]);
    await runCenterActions.savePreset({ ...input, name: 'A' });
    vi.mocked(invoke).mockResolvedValue({ storageScope: '/stores/b' });
    expect(await listPresets()).toEqual([]);
    vi.mocked(invoke).mockResolvedValue({
      storageScope: '/stores/a/environments/one',
    });
    expect(await listPresets()).toEqual([
      expect.objectContaining({ name: 'A' }),
    ]);
    vi.mocked(invoke).mockResolvedValue({});
    await expect(runCenterActions.savePreset(input)).rejects.toThrow();
  });

  it('passes explicit replacement to native code without persisting the invitation', async () => {
    const request = {
      mode: 'replace' as const,
      teamId: 'team-a',
      idempotencyKey: 'request-id',
    };
    const result = { state: 'persisted', teamId: 'team-a', keyId: 'key-id' };
    vi.mocked(invoke).mockResolvedValue(result);
    await expect(
      runCenterActions.enrollTeam!('agent', request),
    ).resolves.toEqual(result);
    expect(invoke).toHaveBeenCalledWith('desktop_enroll_team', {
      identity: 'agent',
      request,
    });
    expect(localStorage.length).toBe(0);
  });

  it('starts native operator sign-in without carrying a browser token', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await runCenterActions.signInOperator!();
    expect(invoke).toHaveBeenCalledWith('desktop_operator_sign_in');
  });
});
