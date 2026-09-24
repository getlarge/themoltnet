import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestWrapper } from '../test-query-client.js';
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
import { CATALOGUE_ERROR } from './useCatalogue.js';

// A fresh cache per test; the wrapper also supplies the theme provider.
let Wrapper = createTestWrapper();
beforeEach(() => {
  Wrapper = createTestWrapper();
});

function setup(
  overrides: Partial<RunCenterData> = {},
  saved = true,
  shapeCatalogue?: (mock: ReturnType<typeof vi.fn>) => void,
) {
  const data: RunCenterData = {
    server: running,
    status,
    runs: [],
    presets: [preset],
    providers: {},
    subscriptions: [],
    ...overrides,
  };
  const catalogueMock = vi.fn().mockResolvedValue(catalogue);
  shapeCatalogue?.(catalogueMock);
  const actions: RunCenterActions = {
    catalogue: catalogueMock,
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
    <Wrapper>
      <RunComposer {...props} />
    </Wrapper>,
  );
  return {
    actions,
    done,
    update: (next: Partial<RunCenterData>) =>
      view.rerender(
        <Wrapper>
          <RunComposer {...props} data={{ ...data, ...next }} />
        </Wrapper>,
      ),
  };
}

describe('run draft and preset operations', () => {
  it('reads the catalogue once for the identity it is offering', async () => {
    const { actions } = setup();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Start run' })).toBeEnabled();
    });
    // One shared entry per identity: the composer no longer keeps a second
    // copy alongside the run center's, and asking twice would mean it does.
    expect(actions.catalogue).toHaveBeenCalledTimes(1);
    expect(actions.catalogue).toHaveBeenCalledWith(status.selectedIdentity);
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
  it('surfaces a catalogue failure and retries the shared entry', async () => {
    const { actions } = setup({}, true, (mock) =>
      mock.mockRejectedValue(new Error('unreachable')),
    );
    await screen.findByText(CATALOGUE_ERROR);
    fireEvent.click(screen.getByRole('button', { name: 'Retry catalogue' }));
    // Retry invalidates the one shared entry rather than a private copy.
    await waitFor(() => expect(actions.catalogue).toHaveBeenCalledTimes(2));
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
  it('blocks launch while the catalogue is still loading', async () => {
    setup({}, true, (mock) => mock.mockReturnValue(new Promise(() => {})));
    expect(
      screen.getAllByText('Loading teams and profiles…').length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Start run' })).toBeDisabled();
  });
  it('blocks launch when the selected profile is gone', async () => {
    setup({}, true, (mock) =>
      mock.mockResolvedValue({ ...catalogue, profiles: [] }),
    );
    await screen.findAllByText(
      'Selected runtime profile is no longer available. Choose another profile.',
    );
    expect(screen.getByRole('button', { name: 'Start run' })).toBeDisabled();
  });
  it('blocks launch without a task type', async () => {
    setup({ presets: [{ ...preset, taskTypes: [] }] });
    await screen.findAllByText('Choose at least one task type.');
    expect(screen.getByRole('button', { name: 'Start run' })).toBeDisabled();
  });
});

describe('run again', () => {
  it('replays the request on the same team and clears hidden options on a team change', async () => {
    const previous = {
      ...status.runs[0],
      agent: 'first-agent',
      mode: 'drain' as const,
      diaryId: undefined,
      correlationId: '78fa1119-6126-44b4-b3aa-249e942ef53b',
      diaryIds: ['41c8030b-fc3f-44df-b84d-df2240087733'],
      pollIntervalMs: 750,
      maxPollIntervalMs: 5_000,
      waitForFirstTaskSec: 15,
      waitAfterTaskSec: 3,
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
      teams: [
        ...catalogue.teams,
        {
          teamId: 'other-team',
          teamName: 'Other team',
          available: true,
          blockers: [],
          defaultDiaryId: null,
          diaries: [],
        },
      ],
      profiles: [
        ...catalogue.profiles,
        {
          ...catalogue.profiles[0],
          id: 'other-profile',
          name: 'Other profile',
          teamId: 'other-team',
        },
      ],
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
      <Wrapper>
        <RunComposer
          data={data}
          actions={actions}
          presetId={null}
          previousRun={previous}
          now={0}
          onDone={vi.fn()}
        />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Start run' })).toBeEnabled();
    });
    expect(screen.getByText('drain')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start run' }));
    await waitFor(() => expect(actions.startRun).toHaveBeenCalled());
    const input = vi.mocked(actions.startRun).mock.calls[0][0];
    expect(input).toMatchObject({ projectId: 'project', location: 'Laptop' });
    expect(input).toMatchObject({
      mode: 'drain',
      correlationId: previous.correlationId,
      diaryIds: previous.diaryIds,
      pollIntervalMs: 750,
      maxPollIntervalMs: 5_000,
      waitForFirstTaskSec: 15,
      waitAfterTaskSec: 3,
    });
    expect(input).not.toHaveProperty('source');
    expect(input).not.toHaveProperty('strategy');
    expect(input).not.toHaveProperty('diaryId');

    vi.mocked(actions.startRun).mockClear();
    fireEvent.change(screen.getByLabelText('Team'), {
      target: { value: 'other-team' },
    });
    fireEvent.change(screen.getByLabelText('Runtime profile'), {
      target: { value: 'other-profile' },
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Start run' })).toBeEnabled();
    });
    expect(screen.getByText('poll')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start run' }));
    await waitFor(() => expect(actions.startRun).toHaveBeenCalled());
    const switched = vi.mocked(actions.startRun).mock.calls[0][0];
    expect(switched).toMatchObject({
      teamId: 'other-team',
      mode: 'poll',
      projectId: null,
      profiles: ['other-profile'],
    });
    for (const field of [
      'correlationId',
      'diaryIds',
      'pollIntervalMs',
      'maxPollIntervalMs',
      'waitForFirstTaskSec',
      'waitAfterTaskSec',
    ]) {
      expect(switched).not.toHaveProperty(field);
    }
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
      <Wrapper>
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
      </Wrapper>,
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
