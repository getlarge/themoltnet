import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import { describe, expect, it, vi } from 'vitest';

import {
  catalogue,
  preset,
  running,
  status,
} from './composer-fixtures.test-support.js';
import { RunComposer } from './RunComposer.js';
import type {
  AgentServerCatalogue,
  DesktopRun,
  RunCenterActions,
  RunCenterData,
} from './types.js';

function setup(overrides: Partial<RunCenterData> = {}, saved = true) {
  const data: RunCenterData = {
    server: running,
    status,
    catalogue,
    runs: [],
    presets: [preset],
    providers: {},
    subscriptions: [],
    ...overrides,
  };
  const actions: RunCenterActions = {
    catalogue: vi.fn().mockResolvedValue(catalogue),
    refresh: vi.fn().mockResolvedValue(undefined),
    startRun: vi.fn().mockResolvedValue(status.runs[0]),
    stopRun: vi.fn(),
    savePreset: vi.fn().mockResolvedValue(preset),
    deletePreset: vi.fn().mockResolvedValue(undefined),
    subscribeRunLogs: () => () => {},
  };
  const done = vi.fn();
  const props = {
    data,
    actions,
    presetId: saved ? preset.id : null,
    now: 0,
    onDone: done,
  };
  const view = render(
    <MoltThemeProvider mode="dark">
      <RunComposer {...props} />
    </MoltThemeProvider>,
  );
  return {
    actions,
    done,
    update: (next: Partial<RunCenterData>) =>
      view.rerender(
        <MoltThemeProvider mode="dark">
          <RunComposer {...props} data={{ ...data, ...next }} />
        </MoltThemeProvider>,
      ),
  };
}

describe('run draft and preset operations', () => {
  it('uses the owned catalogue without fetching it again', async () => {
    const { actions } = setup();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Start run' })).toBeEnabled();
    });
    expect(actions.catalogue).not.toHaveBeenCalled();
  });
  it('launches without updating the saved preset', async () => {
    const { actions } = setup();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Start run' })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start run' }));
    await waitFor(() => expect(actions.startRun).toHaveBeenCalled());
    expect(actions.savePreset).not.toHaveBeenCalled();
  });
  it('saves use-default diary semantics and preserves the preset ID', async () => {
    const { actions } = setup();
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Update preset' }),
      ).toBeEnabled();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Update preset' }));
    await waitFor(() => {
      expect(actions.savePreset).toHaveBeenCalledWith(
        expect.objectContaining({ id: preset.id, diaryId: null }),
      );
    });
  });
  it('shows save failures as alerts and keeps the draft', async () => {
    const { actions } = setup();
    vi.mocked(actions.savePreset).mockRejectedValue(
      new Error('Storage is full'),
    );
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Update preset' }),
      ).toBeEnabled();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Update preset' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Storage is full',
    );
    expect(screen.getByLabelText('Preset name')).toHaveValue(preset.name);
  });
  it('handles delete failures without discarding the draft', async () => {
    const { actions, done } = setup();
    vi.mocked(actions.deletePreset).mockRejectedValue(
      new Error('Storage is read-only'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete preset' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Storage is read-only',
    );
    expect(done).not.toHaveBeenCalled();
  });
  it('uses current preset data after a save and reflects deletion elsewhere', async () => {
    const { update } = setup();
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Update preset' }),
      ).toBeEnabled();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Update preset' }));
    await screen.findByText('Preset saved.');
    update({ presets: [] });
    expect(
      screen.queryByRole('button', { name: 'Update preset' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Save preset' }),
    ).toBeInTheDocument();
  });
  it('shows a captured unavailable team explicitly', async () => {
    setup({ catalogue: { ...catalogue, teams: [] } });
    await screen.findByRole('option', { name: /team.*unavailable/i });
    expect(screen.getByRole('button', { name: 'Start run' })).toBeDisabled();
  });
  it('shares catalogue failures and routes retry to the owner', async () => {
    const { actions } = setup({
      catalogue: null,
      catalogueError: 'Shared catalogue failure',
    });
    expect(screen.getByText('Shared catalogue failure')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry catalogue' }));
    await waitFor(() => expect(actions.refresh).toHaveBeenCalled());
    expect(actions.catalogue).not.toHaveBeenCalled();
  });
  it('clears the team when choosing another identity', async () => {
    const { actions } = setup();
    vi.mocked(actions.catalogue).mockResolvedValue({
      ...catalogue,
      defaultTeamId: null,
      teams: [],
    });
    fireEvent.change(screen.getByLabelText('Identity'), {
      target: { value: 'previous-agent' },
    });
    await waitFor(() => {
      expect(actions.catalogue).toHaveBeenCalledWith('previous-agent');
    });
    expect(screen.getByLabelText('Team')).toHaveValue('');
  });
  it.each([
    {
      data: { catalogueLoading: true },
      problem: 'Loading teams and profiles…',
    },
    {
      data: { catalogue: { ...catalogue, profiles: [] } },
      problem:
        'Selected runtime profile is no longer available. Choose another profile.',
    },
    {
      data: { presets: [{ ...preset, taskTypes: [] }] },
      problem: 'Choose at least one task type.',
    },
  ])('blocks launch when $problem', ({ data, problem }) => {
    setup(data);
    expect(screen.getAllByText(problem).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Start run' })).toBeDisabled();
  });
});

describe('run again', () => {
  it('replays the request rather than the workspace it resolved to', async () => {
    const previous = {
      ...status.runs[0],
      agent: 'first-agent',
      diaryId: undefined,
      projectId: 'project',
      location: 'Laptop',
      workspace: {
        projectId: 'project',
        location: 'Laptop',
        diaryId: 'location-diary',
        source: '/Users/me/old-checkout',
        strategy: 'git-worktree' as const,
      },
    };
    const withProject = {
      ...catalogue,
      projects: [
        {
          id: 'project',
          teamId: 'team',
          name: 'Research project',
          description: null,
          defaultDiaryId: null,
          archived: false,
        },
      ],
    };
    // The location has moved on since the previous run.
    const laptop = {
      name: 'Laptop',
      apiUrl: 'https://api.example',
      teamId: 'team',
      projectId: 'project',
      diaryId: 'diary',
      source: '/Users/me/new-checkout',
      effectiveSource: '/Users/me/new-checkout',
      strategy: 'existing' as const,
      readiness: { ready: true },
    };
    const data: RunCenterData = {
      server: running,
      status,
      catalogue: withProject,
      runs: [previous],
      presets: [],
      providers: {},
      subscriptions: [],
    };
    const actions: RunCenterActions = {
      catalogue: vi.fn().mockResolvedValue(withProject),
      refresh: vi.fn().mockResolvedValue(undefined),
      startRun: vi.fn().mockResolvedValue(status.runs[0]),
      stopRun: vi.fn(),
      savePreset: vi.fn().mockResolvedValue(preset),
      deletePreset: vi.fn().mockResolvedValue(undefined),
      subscribeRunLogs: () => () => {},
      projects: {
        list: vi.fn().mockResolvedValue({ locations: [laptop] }),
        save: vi.fn(),
        remove: vi.fn(),
        chooseFolder: vi.fn(),
      },
    };
    render(
      <MoltThemeProvider mode="dark">
        <RunComposer
          data={data}
          actions={actions}
          presetId={null}
          previousRun={previous}
          now={0}
          onDone={vi.fn()}
        />
      </MoltThemeProvider>,
    );
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Start run' })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start run' }));
    await waitFor(() => expect(actions.startRun).toHaveBeenCalled());
    const input = vi.mocked(actions.startRun).mock.calls[0][0];
    expect(input).toMatchObject({ projectId: 'project', location: 'Laptop' });
    expect(input).not.toHaveProperty('source');
    expect(input).not.toHaveProperty('strategy');
    expect(input).not.toHaveProperty('diaryId');
  });
});

describe('project selection rules', () => {
  const sharedProject = {
    id: 'project',
    teamId: 'team',
    name: 'Research project',
    description: null,
    defaultDiaryId: null,
    archived: false,
  };
  const worktree = {
    name: 'Laptop',
    apiUrl: 'https://api.example',
    teamId: 'team',
    projectId: 'project',
    source: '/Users/me/checkout',
    effectiveSource: '/Users/me/checkout',
    strategy: 'git-worktree' as const,
    readiness: { ready: true },
  };
  function compose(options: {
    projectErrors?: AgentServerCatalogue['projectErrors'];
    previousRun?: DesktopRun;
  }) {
    const withProject: AgentServerCatalogue = {
      ...catalogue,
      projects: [sharedProject],
      projectErrors: options.projectErrors ?? [],
    };
    const actions: RunCenterActions = {
      catalogue: vi.fn().mockResolvedValue(withProject),
      refresh: vi.fn().mockResolvedValue(undefined),
      startRun: vi.fn().mockResolvedValue(status.runs[0]),
      stopRun: vi.fn(),
      savePreset: vi.fn().mockResolvedValue(preset),
      deletePreset: vi.fn().mockResolvedValue(undefined),
      subscribeRunLogs: () => () => {},
      projects: {
        list: vi.fn().mockResolvedValue({ locations: [worktree] }),
        save: vi.fn(),
        remove: vi.fn(),
        chooseFolder: vi.fn().mockResolvedValue('/Users/me/other'),
      },
    };
    render(
      <MoltThemeProvider mode="dark">
        <RunComposer
          data={{
            server: running,
            status,
            catalogue: withProject,
            runs: [],
            presets: [],
            providers: {},
            subscriptions: [],
          }}
          actions={actions}
          presetId={null}
          previousRun={options.previousRun}
          now={0}
          onDone={vi.fn()}
        />
      </MoltThemeProvider>,
    );
    return actions;
  }
  const projectRun = {
    ...status.runs[0],
    agent: 'first-agent',
    diaryId: undefined,
    projectId: 'project',
    location: 'Laptop',
  } as DesktopRun;
  const startButton = () => screen.getByRole('button', { name: 'Start run' });

  it('sends General work explicitly and leaves its diary to the daemon', async () => {
    const actions = compose({
      previousRun: {
        ...status.runs[0],
        agent: 'first-agent',
        diaryId: undefined,
        projectId: null,
      } as DesktopRun,
    });
    await waitFor(() => {
      expect(startButton()).toBeEnabled();
    });
    fireEvent.click(startButton());
    await waitFor(() => expect(actions.startRun).toHaveBeenCalled());
    const input = vi.mocked(actions.startRun).mock.calls[0][0];
    expect(input.projectId).toBeNull();
    expect(input).not.toHaveProperty('diaryId');
  });

  it('keeps an inherited Git worktree when a run folder is chosen', async () => {
    const actions = compose({ previousRun: projectRun });
    await waitFor(() => {
      expect(startButton()).toBeEnabled();
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Choose folder for this run' }),
    );
    await waitFor(() =>
      expect(actions.projects!.chooseFolder).toHaveBeenCalled(),
    );
    await waitFor(() => {
      expect(startButton()).toBeEnabled();
    });
    fireEvent.click(startButton());
    await waitFor(() => expect(actions.startRun).toHaveBeenCalled());
    const input = vi.mocked(actions.startRun).mock.calls[0][0];
    expect(input.source).toBe('/Users/me/other');
    expect(input).not.toHaveProperty('strategy');
  });

  it('blocks an explicit workspace behavior that has no folder', async () => {
    compose({
      previousRun: {
        ...status.runs[0],
        agent: 'first-agent',
        projectId: null,
        strategy: 'existing',
      } as DesktopRun,
    });
    expect(
      await screen.findByText('Choose a folder for this workspace behavior.'),
    ).toBeInTheDocument();
    expect(startButton()).toBeDisabled();
  });

  it('points missing project access to team settings instead of retrying', async () => {
    compose({
      previousRun: projectRun,
      projectErrors: [
        {
          teamId: 'team',
          code: 'forbidden',
          message: 'This team credential cannot list projects.',
        },
      ],
    });
    expect(
      await screen.findByText('Project access needed'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Retry discovery' }),
    ).not.toBeInTheDocument();
    expect(startButton()).toBeDisabled();
  });

  it('keeps a truncated project list usable', async () => {
    compose({
      previousRun: projectRun,
      projectErrors: [
        {
          teamId: 'team',
          code: 'truncated',
          message: 'Only the first projects are listed.',
        },
      ],
    });
    expect(
      await screen.findByText('Some projects are not listed'),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(startButton()).toBeEnabled();
    });
  });
});
