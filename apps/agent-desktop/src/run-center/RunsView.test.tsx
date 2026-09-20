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
