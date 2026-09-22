import { invoke } from '@tauri-apps/api/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  listPresets,
  projectActions,
  runCenterActions,
} from './run-center-bridge.js';

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

  it('reads the selected preset namespace without requiring a running daemon', async () => {
    localStorage.setItem(
      'moltnet.run-presets.v1:/stores/offline',
      JSON.stringify([{ name: 'Offline worker' }]),
    );
    vi.mocked(invoke).mockImplementation((command) =>
      command === 'desktop_preset_storage_scope'
        ? Promise.resolve({ storageScope: '/stores/offline' })
        : Promise.reject(new Error('The Agent Server is stopped')),
    );
    await expect(listPresets()).resolves.toEqual([{ name: 'Offline worker' }]);
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

  it('passes project selection and run-only overrides through the native bridge', async () => {
    vi.mocked(invoke).mockResolvedValue({ id: 'run' });
    const input = {
      agent: 'agent',
      teamId: 'team',
      profiles: ['profile'],
      taskTypes: ['freeform'],
      mode: 'poll' as const,
      projectId: 'project',
      location: 'Laptop',
      source: '/work/override',
      strategy: 'existing' as const,
      diaryId: 'diary',
    };
    await runCenterActions.startRun(input);
    expect(invoke).toHaveBeenCalledWith('desktop_start_run', { spec: input });
    expect(localStorage.length).toBe(0);
  });

  it('starts native operator sign-in without carrying a browser token', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await runCenterActions.signInOperator!();
    expect(invoke).toHaveBeenCalledWith('desktop_operator_sign_in');
  });
});

describe('native project location bridge', () => {
  beforeEach(() => vi.clearAllMocks());

  it('routes each action to its registered native command', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    const input = {
      name: 'Laptop',
      identity: 'agent',
      teamId: 'team',
      projectId: 'project',
      strategy: 'existing' as const,
    };

    await projectActions.list();
    await projectActions.save(input);
    await projectActions.remove('Laptop');
    await projectActions.chooseFolder();

    expect(vi.mocked(invoke).mock.calls).toEqual([
      ['desktop_project_locations'],
      ['desktop_save_project_location', { input }],
      ['desktop_remove_project_location', { name: 'Laptop' }],
      ['desktop_choose_project_folder'],
    ]);
  });
});
