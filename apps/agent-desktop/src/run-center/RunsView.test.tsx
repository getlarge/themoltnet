import { fireEvent, render, screen } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import { describe, expect, it, vi } from 'vitest';

import { INITIAL_STATUS } from '../bridge.js';
import { RunsView } from './RunsView.js';
import type { DesktopRun, RunCenterActions, RunCenterData } from './types.js';

const run: DesktopRun = {
  id: 'run',
  agent: 'agent',
  teamId: 'team',
  profiles: ['profile'],
  taskTypes: ['freeform'],
  mode: 'poll',
  status: 'running',
  active: true,
  startedAt: '2026-09-18T00:00:00Z',
  teamName: 'Research',
  presetName: null,
  credential: null,
};

function fixture(stopRun: RunCenterActions['stopRun']) {
  const data: RunCenterData = {
    server: { ...INITIAL_STATUS, state: 'running' },
    status: null,
    runs: [run],
    presets: [],
    catalogue: null,
  };
  const actions: RunCenterActions = {
    catalogue: vi.fn().mockResolvedValue(null),
    startRun: vi.fn(),
    stopRun,
    savePreset: vi.fn(),
    deletePreset: vi.fn(),
    subscribeRunLogs: () => () => {},
  };
  return { data, actions };
}

describe('stopping a run from the list', () => {
  it('surfaces a rejection instead of silently clearing the spinner', async () => {
    const { data, actions } = fixture(
      vi.fn().mockRejectedValue(new Error('unavailable')),
    );
    render(
      <MoltThemeProvider mode="dark">
        <RunsView
          data={data}
          actions={actions}
          now={Date.parse('2026-09-19T00:00:00Z')}
          route={{ kind: 'list' }}
          onRoute={() => {}}
        />
      </MoltThemeProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await screen.findByText('Run could not be stopped');
    expect(actions.stopRun).toHaveBeenCalledWith('run');
    expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled();
  });

  it('shows no failure notice when the run stops cleanly', async () => {
    const { data, actions } = fixture(vi.fn().mockResolvedValue(undefined));
    render(
      <MoltThemeProvider mode="dark">
        <RunsView
          data={data}
          actions={actions}
          now={Date.parse('2026-09-19T00:00:00Z')}
          route={{ kind: 'list' }}
          onRoute={() => {}}
        />
      </MoltThemeProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await screen.findByRole('button', { name: 'Stop' });
    expect(actions.stopRun).toHaveBeenCalledWith('run');
    expect(screen.queryByText('Run could not be stopped')).toBeNull();
  });
});

describe('catalogue state in the Runs overview', () => {
  it.each([
    {
      catalogueLoading: true,
      catalogueError: null,
      message: 'Loading teams and profiles…',
    },
    {
      catalogueLoading: false,
      catalogueError: 'Catalogue request failed',
      message: 'Catalogue unavailable',
    },
  ])('distinguishes $message from enrollment', (state) => {
    const { data, actions } = fixture(vi.fn());
    actions.refresh = vi.fn().mockResolvedValue(undefined);
    render(
      <MoltThemeProvider mode="dark">
        <RunsView
          data={{ ...data, ...state }}
          actions={actions}
          now={0}
          route={{ kind: 'list' }}
          onRoute={() => {}}
        />
      </MoltThemeProvider>,
    );
    expect(screen.queryByText('Team enrollment required')).toBeNull();
    expect(screen.getByText(state.message)).toBeInTheDocument();
    if (state.catalogueError) {
      fireEvent.click(screen.getByRole('button', { name: 'Retry catalogue' }));
      expect(actions.refresh).toHaveBeenCalledOnce();
    }
  });

  it('describes an empty catalogue without claiming a credential failure', () => {
    const { data, actions } = fixture(vi.fn());
    render(
      <MoltThemeProvider mode="dark">
        <RunsView
          data={{
            ...data,
            catalogue: { defaultTeamId: null, teams: [], profiles: [] },
          }}
          actions={actions}
          now={0}
          route={{ kind: 'list' }}
          onRoute={() => {}}
        />
      </MoltThemeProvider>,
    );
    expect(screen.getByText('No teams found')).toBeInTheDocument();
    expect(screen.queryByText('Team enrollment required')).toBeNull();
  });
});

it('offers catalogue retry when upstream team verification cannot complete', () => {
  const { data, actions } = fixture(vi.fn());
  render(
    <MoltThemeProvider mode="dark">
      <RunsView
        data={{
          ...data,
          catalogue: {
            defaultTeamId: null,
            profiles: [],
            teams: [
              {
                teamId: 'team',
                teamName: 'Research',
                available: false,
                diaries: [],
                defaultDiaryId: null,
                blockers: [
                  {
                    code: 'agent_key_unavailable',
                    message: 'Resources unavailable',
                    remedy: 'Check connectivity',
                  },
                ],
              },
            ],
          },
        }}
        actions={actions}
        now={0}
        route={{ kind: 'list' }}
        onRoute={() => {}}
      />
    </MoltThemeProvider>,
  );
  expect(
    screen.getByRole('button', { name: 'Retry catalogue' }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Identity and teams' }),
  ).toBeNull();
});
