import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { INITIAL_STATUS } from '../bridge.js';
import { createTestWrapper } from '../test-query-client.js';
import { RunsView } from './RunsView.js';
import type { DesktopRun, RunCenterActions, RunCenterData } from './types.js';

// A fresh cache per test; the wrapper also supplies the theme provider.
let Wrapper = createTestWrapper();
beforeEach(() => {
  Wrapper = createTestWrapper();
});

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
    status: {
      agents: [{ agentName: 'agent' }],
      selectedIdentity: 'agent',
    } as unknown as RunCenterData['status'],
    runs: [run],
    presets: [],
  };
  const actions: RunCenterActions = {
    catalogue: vi.fn().mockResolvedValue(EMPTY_CATALOGUE),
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
      <Wrapper>
        <RunsView
          data={data}
          actions={actions}
          now={Date.parse('2026-09-19T00:00:00Z')}
          route={{ kind: 'list' }}
          onRoute={() => {}}
        />
      </Wrapper>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await screen.findByText('Run could not be stopped');
    expect(actions.stopRun).toHaveBeenCalledWith('run');
    expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled();
  });

  it('shows no failure notice when the run stops cleanly', async () => {
    const { data, actions } = fixture(vi.fn().mockResolvedValue(undefined));
    render(
      <Wrapper>
        <RunsView
          data={data}
          actions={actions}
          now={Date.parse('2026-09-19T00:00:00Z')}
          route={{ kind: 'list' }}
          onRoute={() => {}}
        />
      </Wrapper>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await screen.findByRole('button', { name: 'Stop' });
    expect(actions.stopRun).toHaveBeenCalledWith('run');
    expect(screen.queryByText('Run could not be stopped')).toBeNull();
  });
});

const EMPTY_CATALOGUE = {
  projects: [],
  projectErrors: [],
  defaultTeamId: null,
  teams: [],
  profiles: [],
};

function renderRuns(actions: RunCenterActions, data: RunCenterData) {
  return render(
    <Wrapper>
      <RunsView
        data={data}
        actions={actions}
        now={0}
        route={{ kind: 'list' }}
        onRoute={() => {}}
      />
    </Wrapper>,
  );
}

describe('catalogue state in the Runs overview', () => {
  it('reports the first catalogue load without claiming enrollment is needed', () => {
    const { data, actions } = fixture(vi.fn());
    // Never settles, so the first-load state is observable.
    actions.catalogue = vi.fn().mockReturnValue(new Promise(() => {}));
    renderRuns(actions, data);
    expect(screen.queryByText('Team enrollment required')).toBeNull();
    expect(screen.getByText('Loading teams and profiles…')).toBeInTheDocument();
  });

  it('offers a retry when the catalogue cannot be read', async () => {
    const { data, actions } = fixture(vi.fn());
    actions.catalogue = vi.fn().mockRejectedValue(new Error('unreachable'));
    renderRuns(actions, data);
    await screen.findByText('Catalogue unavailable');
    expect(screen.queryByText('Team enrollment required')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Retry catalogue' }));
    await waitFor(() => expect(actions.catalogue).toHaveBeenCalledTimes(2));
  });

  it('describes an empty catalogue without claiming a credential failure', async () => {
    const { data, actions } = fixture(vi.fn());
    actions.catalogue = vi.fn().mockResolvedValue(EMPTY_CATALOGUE);
    renderRuns(actions, data);
    await screen.findByText('No teams found');
    expect(screen.queryByText('Team enrollment required')).toBeNull();
  });
});

it('offers catalogue retry when upstream team verification cannot complete', async () => {
  const { data, actions } = fixture(vi.fn());
  actions.catalogue = vi.fn().mockResolvedValue({
    ...EMPTY_CATALOGUE,
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
          },
        ],
      },
    ],
  });
  renderRuns(actions, data);
  await screen.findByText('Catalogue unavailable');
  fireEvent.click(screen.getByRole('button', { name: 'Retry catalogue' }));
  await waitFor(() => expect(actions.catalogue).toHaveBeenCalledTimes(2));
});

it('keeps a matching preset selected when repeating an attributed run', () => {
  const { data, actions } = fixture(vi.fn());
  const onRoute = vi.fn();
  const previous = {
    ...run,
    status: 'stopped' as const,
    active: false,
    diaryId: 'new-default',
  };
  render(
    <Wrapper>
      <RunsView
        data={{
          ...data,
          runs: [previous],
          presets: [
            {
              id: 'saved',
              name: 'Worker',
              agent: run.agent,
              teamId: run.teamId,
              diaryId: null,
              version: 2,
              profileIds: run.profiles,
              taskTypes: run.taskTypes,
              createdAt: run.startedAt,
              lastUsedAt: null,
            },
          ],
        }}
        actions={actions}
        now={0}
        route={{ kind: 'detail', runId: run.id }}
        onRoute={onRoute}
      />
    </Wrapper>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Run again' }));
  expect(onRoute).toHaveBeenCalledWith({
    kind: 'compose',
    presetId: 'saved',
    previousRun: previous,
  });
});
