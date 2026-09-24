import {
  AGENT_CREDENTIAL_SCOPES,
  DAEMON_MINIMUM_SCOPES,
} from '@moltnet/models';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { INITIAL_STATUS } from '../bridge.js';
import { createTestWrapper } from '../test-query-client.js';
import { TeamsView } from './TeamsView.js';
import type { RunCenterActions, RunCenterData } from './types.js';

// A fresh cache per test; the wrapper also supplies the theme provider.
let Wrapper = createTestWrapper();
beforeEach(() => {
  Wrapper = createTestWrapper();
});

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
    providers: {},
    subscriptions: [],
  };
  const actions: RunCenterActions = {
    catalogue: vi.fn().mockResolvedValue({
      teams: [team],
      profiles: [],
      projects: [],
      projectErrors: [],
      defaultTeamId: null,
    }),
    enrollTeam: vi.fn().mockResolvedValue({
      state: 'persisted',
      teamId: 'team-a',
      keyId: 'new-key',
      scopes: ['agent:profile', 'task:execute'],
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
    <Wrapper>
      <TeamsView
        data={data}
        actions={actions}
        now={Date.parse('2026-09-18T00:00:00Z')}
      />
    </Wrapper>,
  );
}

describe('desktop team enrollment', () => {
  it('shows the signed-in operator email', () => {
    const { data, actions } = fixture();
    show(
      { ...data, operatorConfigured: true, operatorEmail: 'owner@example.com' },
      actions,
    );
    expect(screen.getByText('owner@example.com')).toBeInTheDocument();
  });

  it('creates a first agent with a team invite code', async () => {
    const { data, actions } = fixture();
    data.status = { ...data.status!, agents: [], selectedIdentity: undefined };
    actions.createManagedAgent = vi.fn().mockResolvedValue({
      kind: 'managed',
      agentName: 'first-agent',
      subjectId: 'subject',
      fingerprint: 'fingerprint',
      apiUrl: 'https://api.themolt.net',
      createdAt: '2026-09-23T00:00:00Z',
      hasAgentKey: true,
      hasPrivateKey: true,
    });
    show(data, actions);
    fireEvent.change(screen.getByLabelText('Agent name'), {
      target: { value: 'first-agent' },
    });
    fireEvent.change(screen.getByLabelText('Team invite code'), {
      target: { value: 'mlt_inv_example' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create and enroll' }));
    expect(actions.createManagedAgent).toHaveBeenCalledWith(
      'first-agent',
      'mlt_inv_example',
    );
    expect(
      await screen.findByText('Agent identity created'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Identity')).toHaveValue('first-agent');
  });

  it('offers identity creation when agents already exist', () => {
    const { data, actions } = fixture();
    show(data, actions);
    fireEvent.click(screen.getByRole('button', { name: 'Create identity' }));
    expect(screen.getByLabelText('Team invite code')).toBeInTheDocument();
  });

  it('keeps the entered name after an unconfirmed registration', async () => {
    const { data, actions } = fixture();
    actions.createManagedAgent = vi
      .fn()
      .mockRejectedValue(new Error('unavailable'));
    show(data, actions);
    fireEvent.click(screen.getByRole('button', { name: 'Create identity' }));
    fireEvent.change(screen.getByLabelText('Agent name'), {
      target: { value: 'example-agent' },
    });
    fireEvent.change(screen.getByLabelText('Team invite code'), {
      target: { value: 'mlt_inv_example' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create and enroll' }));
    expect(
      await screen.findByText('Identity creation could not be confirmed'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Agent name')).toHaveValue('example-agent');
  });

  it('shows a dismissible toast after sign-in completes', async () => {
    const { data, actions } = fixture();
    actions.signInOperator = vi.fn().mockResolvedValue(undefined);
    actions.operatorTeams = vi.fn().mockResolvedValue({
      items: [
        { id: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'Operations' },
      ],
    });
    show(data, actions);
    await screen.findByText('Research');
    fireEvent.click(
      screen.getByRole('button', { name: 'Sign in as operator' }),
    );
    expect(
      await screen.findByRole('status', { name: 'Approval completed' }),
    ).toHaveTextContent('Local operator signed in');
    expect(
      await screen.findByRole('option', { name: 'Operations' }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Dismiss notification' }),
    );
    expect(
      screen.queryByRole('status', { name: 'Approval completed' }),
    ).not.toBeInTheDocument();
  });
  it('shows the persisted operator state and offers a team-list refresh', async () => {
    const { data, actions } = fixture();
    show({ ...data, operatorConfigured: true }, actions);
    expect(await screen.findByText('Signed in')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Refresh operator teams' }),
    ).toBeInTheDocument();
  });
  it('selects a signed-in operator team by name for enrollment', async () => {
    const { data, actions } = fixture();
    const teamId = 'aaaaaaaa-0000-4000-8000-000000000001';
    actions.operatorTeams = vi.fn().mockResolvedValue({
      items: [{ id: teamId, name: 'Research' }],
    });
    show({ ...data, operatorConfigured: true }, actions);
    const selector = await screen.findByRole('combobox', { name: 'Team' });
    fireEvent.change(selector, { target: { value: teamId } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve in browser' }));
    expect(actions.enrollTeam).toHaveBeenCalledWith(
      'agent',
      expect.objectContaining({ teamId, mode: 'enroll' }),
    );
  });
  it('cancels an abandoned sign-in and enables retry after native cancellation', async () => {
    const { data, actions } = fixture();
    let rejectApproval!: (error: Error) => void;
    const signIn = vi.fn(
      () =>
        new Promise<void>((_, reject) => {
          rejectApproval = reject;
        }),
    );
    const cancel = vi.fn(async () => {
      rejectApproval(new Error('Approval cancelled'));
    });
    actions.signInOperator = signIn;
    actions.cancelOperatorApproval = cancel;
    show(data, actions);
    await screen.findByText('Research');
    fireEvent.click(
      screen.getByRole('button', { name: 'Sign in as operator' }),
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Cancel approval' }),
    );
    expect(await screen.findByText('Approval cancelled')).toBeInTheDocument();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('button', { name: 'Sign in as operator' }),
    ).toBeEnabled();
  });
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

  it('starts renewal from verified scopes and submits an exact optional choice', async () => {
    const { data, actions } = fixture();
    actions.catalogue = vi.fn().mockResolvedValue({
      teams: [
        {
          ...team,
          credential: {
            ...team.credential,
            scopes: [...DAEMON_MINIMUM_SCOPES, 'diary:write'],
          },
        },
      ],
      profiles: [],
      projects: [],
      projectErrors: [],
      defaultTeamId: null,
    });
    show(data, actions);
    await screen.findByText('Research');
    fireEvent.click(screen.getByRole('button', { name: 'Renew' }));
    expect(screen.getByRole('checkbox', { name: /diary:write/ })).toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: /team:read/ }),
    ).not.toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: /diary:write/ }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Replace team credential' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Replace credential' }));
    await screen.findByText('Team credential renewed');
    expect(actions.enrollTeam).toHaveBeenCalledWith(
      'agent',
      expect.objectContaining({ scopes: [...DAEMON_MINIMUM_SCOPES] }),
    );
  });

  it('submits the selected optional scope for a new enrollment', async () => {
    const { data, actions } = fixture();
    show(data, actions);
    await screen.findByText('Research');
    fireEvent.change(screen.getByLabelText('Team ID'), {
      target: { value: 'new-team' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /diary:write/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve in browser' }));
    await screen.findByText('Team enrollment complete');
    expect(actions.enrollTeam).toHaveBeenCalledWith(
      'agent',
      expect.objectContaining({
        scopes: [...AGENT_CREDENTIAL_SCOPES, 'diary:write'],
      }),
    );
  });

  it('restores a captured credential through the Agent Server without exposing its secret', async () => {
    const { data, actions } = fixture();
    actions.listEnrollmentRecoveries = vi.fn().mockResolvedValue({
      items: [
        {
          recoveryId: 'record.json',
          secretCaptured: true,
          teamId: 'team-a',
          operation: 'renew',
          createdAt: '2026-09-01T00:00:00Z',
        },
      ],
    });
    actions.restoreEnrollment = vi.fn().mockResolvedValue({
      state: 'persisted',
      teamId: 'team-a',
      keyId: 'restored',
    });
    show(data, actions);
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Restore captured credential',
      }),
    );
    await screen.findByText('Credential restored');
    expect(actions.restoreEnrollment).toHaveBeenCalledWith(
      'agent',
      'record.json',
    );
    expect(actions.catalogue).toHaveBeenCalledTimes(2);
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
    fireEvent.click(screen.getByRole('button', { name: 'Approve in browser' }));
    await screen.findByText('Enrollment needs recovery');
    expect(
      screen.getByText(/No credential secret was captured/),
    ).toHaveTextContent('No secret is available to restore');
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
      projects: [],
      projectErrors: [],
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
