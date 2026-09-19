import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import { describe, expect, it, vi } from 'vitest';

import { INITIAL_STATUS } from '../bridge.js';
import { TeamsView } from './TeamsView.js';
import type { RunCenterActions, RunCenterData } from './types.js';

const team = {
  teamId: 'team-a',
  teamName: 'Research',
  available: false,
  blockers: [
    {
      code: 'agent_key_unavailable',
      message: 'Credential unavailable',
      remedy: 'Renew team access.',
    },
  ],
  diaries: [],
  defaultDiaryId: null,
  credential: {
    keyId: 'old-key',
    expiresAt: '2026-09-01T00:00:00Z',
    verifiedAt: '2026-08-30T00:00:00Z',
    scopes: [],
  },
};
function fixture() {
  const data: RunCenterData = {
    server: { ...INITIAL_STATUS, state: 'running' },
    status: {
      version: '1',
      platform: 'darwin',
      subscriptions: [],
      agents: [
        {
          kind: 'managed',
          agentName: 'agent',
          subjectId: 'subject',
          fingerprint: 'fingerprint',
          apiUrl: 'https://api.themolt.net',
          createdAt: '2026-01-01T00:00:00Z',
          hasAgentKey: true,
          hasPrivateKey: true,
        },
      ],
      identities: [],
      selectedIdentity: 'agent',
      providers: {},
      runs: [],
      runtimeSettings: { heartbeatIntervalMs: 1000, warmRetentionSec: 10 },
    },
    catalogue: null,
    runs: [],
    presets: [],
  };
  const actions: RunCenterActions = {
    catalogue: vi
      .fn()
      .mockResolvedValue({ teams: [team], profiles: [], defaultTeamId: null }),
    enrollTeam: vi.fn().mockResolvedValue({
      state: 'persisted',
      teamId: 'team-a',
      keyId: 'new-key',
    }),
    refresh: vi.fn().mockResolvedValue(undefined),
    startRun: vi.fn(),
    stopRun: vi.fn(),
    savePreset: vi.fn(),
    deletePreset: vi.fn(),
    subscribeRunLogs: () => () => {},
  };
  return { data, actions };
}
function show(data: RunCenterData, actions: RunCenterActions) {
  return render(
    <MoltThemeProvider mode="dark">
      <TeamsView
        data={data}
        actions={actions}
        now={Date.parse('2026-09-18T00:00:00Z')}
      />
    </MoltThemeProvider>,
  );
}

describe('desktop team enrollment', () => {
  it('confirms the exact replacement and leaves active runs alone', async () => {
    const { data, actions } = fixture();
    show(data, actions);
    expect(await screen.findByText('Expired')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Renew' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Replace team credential' }),
    );
    expect(actions.enrollTeam).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Replace credential' }));
    await screen.findByText('Team credential renewed');
    expect(actions.enrollTeam).toHaveBeenCalledWith(
      'agent',
      expect.objectContaining({
        mode: 'replace',
        teamId: 'team-a',
      }),
    );
    expect(actions.refresh).toHaveBeenCalledOnce();
    expect(actions.stopRun).not.toHaveBeenCalled();
  });

  it('shows lost-response recovery without claiming a captured secret', async () => {
    const { data, actions } = fixture();
    vi.mocked(actions.enrollTeam!).mockResolvedValue({
      state: 'recovery_required',
      secretCaptured: false,
      issuedKeyId: 'issued-key',
      recoveryId: 'record.json',
      message: 'No credential secret was captured.',
    });
    show(data, actions);
    await screen.findByText('Research');
    fireEvent.change(screen.getByLabelText('Team ID'), {
      target: { value: 'single-use-sentinel' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Approve in Console' }));
    await screen.findByText('Enrollment needs recovery');
    expect(
      screen.getByText(/No credential secret was captured/),
    ).toHaveTextContent('issued-key');
    expect(
      screen.queryByText('Credential saved for recovery'),
    ).not.toBeInTheDocument();
  });

  it('refreshes unavailable team access after an external renewal', async () => {
    const { data, actions } = fixture();
    show(data, actions);
    await screen.findByText('Expired');
    vi.mocked(actions.catalogue).mockResolvedValue({
      teams: [
        {
          ...team,
          available: true,
          blockers: [],
          credential: {
            ...team.credential,
            keyId: 'renewed',
            expiresAt: '2027-09-18T00:00:00Z',
          },
        },
      ],
      profiles: [],
      defaultTeamId: 'team-a',
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Refresh team access' }),
    );
    await screen.findByText('Healthy');
    expect(actions.stopRun).not.toHaveBeenCalled();
  });
  it('clears a refresh error after team access is verified again', async () => {
    const { data, actions } = fixture();
    vi.mocked(actions.catalogue).mockRejectedValueOnce(new Error('offline'));
    show(data, actions);
    await screen.findByText('Team access could not be refreshed');
    fireEvent.click(
      screen.getByRole('button', { name: 'Refresh team access' }),
    );
    await screen.findByText('Research');
    expect(
      screen.queryByText('Team access could not be refreshed'),
    ).not.toBeInTheDocument();
  });
});
