import { invoke } from '@tauri-apps/api/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runCenterActions } from './run-center-bridge.js';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

describe('native team enrollment bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('passes explicit replacement to native code without persisting the invitation', async () => {
    const request = {
      mode: 'replace' as const,
      teamId: 'team-a',
      code: 'invitation-sentinel',
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

  it('opens Console with only the selected team identifier', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await runCenterActions.openTeamInvites!('team-a');
    expect(invoke).toHaveBeenCalledWith('desktop_team_invites', {
      teamId: 'team-a',
    });
  });
});
