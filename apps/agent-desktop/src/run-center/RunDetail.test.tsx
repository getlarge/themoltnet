import { act, fireEvent, render, screen } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import { describe, expect, it, vi } from 'vitest';

import { expiryLabel } from './credential-health.js';
import { RunDetail } from './RunDetail.js';
import type { DesktopRun, RunCenterActions } from './types.js';

const credential = {
  keyId: 'predecessor',
  expiresAt: '2026-09-22T00:00:00Z',
  verifiedAt: '2026-09-18T00:00:00Z',
  scopes: [],
};
const run: DesktopRun = {
  id: 'run',
  agent: 'another-identity',
  teamId: 'team',
  profiles: ['profile'],
  taskTypes: ['freeform'],
  mode: 'poll',
  status: 'running',
  active: true,
  startedAt: '2026-09-18T00:00:00Z',
  teamName: 'Research',
  presetName: null,
  credential,
};

describe('captured run credential', () => {
  it('checks the viewed identity and warns about replacement without changing or stopping the run', async () => {
    const actions: RunCenterActions = {
      catalogue: vi.fn().mockResolvedValue({
        projects: [],
        teams: [
          {
            teamId: 'team',
            diaries: [],
            credential: {
              ...credential,
              keyId: 'replacement',
              expiresAt: '2027-01-01T00:00:00Z',
            },
          },
        ],
        profiles: [],
        projects: [],
        projectErrors: [],
        defaultTeamId: 'team',
      }),
      startRun: vi.fn(),
      stopRun: vi.fn().mockRejectedValue(new Error('unavailable')),
      savePreset: vi.fn(),
      deletePreset: vi.fn(),
      subscribeRunLogs: () => () => {},
    };
    render(
      <MoltThemeProvider mode="dark">
        <RunDetail
          run={run}
          actions={actions}
          now={Date.parse('2026-09-19T00:00:00Z')}
          onBack={() => {}}
          onRunAgain={() => {}}
        />
      </MoltThemeProvider>,
    );
    await screen.findByText('Replacement available—restart to use it');
    expect(actions.catalogue).toHaveBeenCalledWith('another-identity');
    expect(
      screen.getByText(`Run credential: ${expiryLabel(credential.expiresAt)}`),
    ).toBeInTheDocument();
    expect(run.credential?.keyId).toBe('predecessor');
    expect(actions.stopRun).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await screen.findByText('Run could not be stopped');
    expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled();
  });
});

it('suspends catalogue refresh and logs when hidden and resumes when visible', async () => {
  vi.useFakeTimers();
  const unsubscribe = vi.fn();
  const actions: RunCenterActions = {
    catalogue: vi.fn().mockResolvedValue({ teams: [], projects: [] }),
    startRun: vi.fn(),
    stopRun: vi.fn(),
    savePreset: vi.fn(),
    deletePreset: vi.fn(),
    subscribeRunLogs: vi.fn().mockReturnValue(unsubscribe),
  };
  const renderDetail = (active: boolean) => (
    <MoltThemeProvider mode="dark">
      <RunDetail
        active={active}
        run={run}
        actions={actions}
        now={0}
        onBack={() => {}}
        onRunAgain={() => {}}
      />
    </MoltThemeProvider>
  );
  const view = render(renderDetail(true));
  expect(actions.subscribeRunLogs).toHaveBeenCalledTimes(1);
  view.rerender(renderDetail(false));
  expect(unsubscribe).toHaveBeenCalledTimes(1);
  const previousCalls = vi.mocked(actions.catalogue).mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(31000);
  });
  view.rerender(renderDetail(false));
  expect(actions.catalogue).toHaveBeenCalledTimes(previousCalls);
  view.rerender(renderDetail(true));
  expect(actions.subscribeRunLogs).toHaveBeenCalledTimes(2);
  vi.useRealTimers();
});

describe('captured workspace panel', () => {
  const actions = (): RunCenterActions => ({
    catalogue: vi.fn().mockResolvedValue({
      teams: [
        {
          teamId: 'team',
          diaries: [{ id: 'diary', name: 'Research diary' }],
          credential,
        },
      ],
      projects: [{ id: 'project', teamId: 'team', name: 'Research project' }],
    }),
    startRun: vi.fn(),
    stopRun: vi.fn(),
    savePreset: vi.fn(),
    deletePreset: vi.fn(),
    subscribeRunLogs: vi.fn().mockReturnValue(() => {}),
  });
  const renderRun = (value: DesktopRun) =>
    render(
      <MoltThemeProvider mode="dark">
        <RunDetail
          run={value}
          actions={actions()}
          now={0}
          onBack={() => {}}
          onRunAgain={() => {}}
        />
      </MoltThemeProvider>,
    );

  it('shows what the run resolved to, with catalogue names', async () => {
    renderRun({
      ...run,
      workspace: {
        projectId: 'project',
        location: 'Laptop',
        diaryId: 'diary',
        source: '/Users/me/checkout',
        strategy: 'existing',
      },
    });
    expect(await screen.findByText('Research project')).toBeInTheDocument();
    expect(await screen.findByText('Research diary')).toBeInTheDocument();
    expect(screen.getByText('Laptop')).toBeInTheDocument();
    expect(screen.getByText('/Users/me/checkout')).toBeInTheDocument();
  });

  it('omits the panel for a run started without project selection', () => {
    renderRun(run);
    expect(screen.queryByText('Captured workspace')).not.toBeInTheDocument();
  });
});
