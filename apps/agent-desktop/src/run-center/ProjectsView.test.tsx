import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import { describe, expect, it, vi } from 'vitest';

import { INITIAL_STATUS } from '../bridge.js';
import { ProjectsView } from './ProjectsView.js';
import type {
  AgentServerCatalogue,
  AgentServerStatus,
  ProjectActions,
  ProjectLocation,
  RunCenterActions,
  RunCenterData,
  SaveProjectLocationInput,
} from './types.js';

const running = { ...INITIAL_STATUS, state: 'running' as const };
const status: AgentServerStatus = {
  agents: [
    {
      agentName: 'first-agent',
      subjectId: 'first-agent',
      kind: 'managed',
      createdAt: '2026-09-01T00:00:00Z',
      hasAgentKey: true,
      hasPrivateKey: true,
    },
  ],
  selectedIdentity: 'first-agent',
  identities: [],
  platform: 'darwin',
  providers: {},
  subscriptions: [],
  version: 'fixture',
  runtimeSettings: { heartbeatIntervalMs: 1000, warmRetentionSec: 10 },
  runs: [],
};
const catalogue: AgentServerCatalogue = {
  projects: [],
  projectErrors: [],
  defaultTeamId: 'team',
  teams: [
    {
      teamId: 'team',
      teamName: 'Research',
      available: true,
      blockers: [],
      defaultDiaryId: 'diary',
      diaries: [{ id: 'diary', name: 'Research diary' }],
    },
  ],
  profiles: [],
};

const project = {
  id: 'project',
  teamId: 'team',
  name: 'Research workspace',
  description: 'Shared research',
  defaultDiaryId: 'diary',
  archived: false,
};
const location: ProjectLocation = {
  name: 'Laptop',
  apiUrl: 'https://api.example',
  teamId: 'team',
  projectId: 'project',
  source: '/work/research',
  effectiveSource: '/work/research',
  strategy: 'existing',
  default: true,
  readiness: { ready: true },
};
function setup(locations: ProjectLocation[] = [], waitingForIdentity = false) {
  const data: RunCenterData = {
    server: running,
    status: waitingForIdentity ? null : status,
    runs: [],
    presets: [],
    catalogue: null,
    providers: {},
    subscriptions: [],
  };
  const actions: RunCenterActions = {
    catalogue: vi.fn().mockResolvedValue({ ...catalogue, projects: [project] }),
    startRun: vi.fn(),
    stopRun: vi.fn(),
    savePreset: vi.fn(),
    deletePreset: vi.fn(),
    subscribeRunLogs: () => () => {},
  };
  const projects: ProjectActions = {
    list: vi.fn().mockResolvedValue({ locations }),
    save: vi.fn().mockImplementation((input: SaveProjectLocationInput) =>
      Promise.resolve({
        ...input,
        apiUrl: 'https://api.example',
        effectiveSource: input.source,
        readiness: { ready: true },
      }),
    ),
    remove: vi.fn().mockResolvedValue(undefined),
    chooseFolder: vi.fn().mockResolvedValue('/work/new'),
  };
  const onTeams = vi.fn();
  const view = render(
    <MoltThemeProvider mode="dark">
      <ProjectsView
        data={data}
        actions={actions}
        projects={projects}
        onTeams={onTeams}
      />
    </MoltThemeProvider>,
  );
  return {
    actions,
    projects,
    onTeams,
    hydrate: () =>
      view.rerender(
        <MoltThemeProvider mode="dark">
          <ProjectsView
            data={{ ...data, status }}
            actions={actions}
            projects={projects}
            onTeams={onTeams}
          />
        </MoltThemeProvider>,
      ),
  };
}

describe('Projects and local locations', () => {
  it('discovers projects when the identity snapshot arrives after opening the view', async () => {
    const { hydrate } = setup([], true);
    expect(screen.getByLabelText('Identity')).toHaveValue('');
    hydrate();
    await screen.findByRole('heading', { name: 'Shared with the team' });
    expect(screen.getByLabelText('Identity')).toHaveValue('first-agent');
  });
  it('separates shared project details from machine locations and shows defaults', async () => {
    setup([
      location,
      {
        ...location,
        name: 'Archive',
        default: false,
        readiness: {
          ready: false,
          message:
            'The source folder is unavailable. Choose an existing folder.',
        },
      },
    ]);
    await screen.findByRole('heading', { name: 'Shared with the team' });
    expect(
      screen.getByRole('heading', { name: 'On this computer' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Shared research')).toBeInTheDocument();
    expect(screen.getByText('Laptop')).toBeInTheDocument();
    expect(screen.getByText('Default location')).toBeInTheDocument();
    expect(
      screen.getByText(
        'The source folder is unavailable. Choose an existing folder.',
      ),
    ).toBeInTheDocument();
  });

  it('chooses a native folder and explicitly saves a location without starting work', async () => {
    const { actions, projects } = setup();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Add local location' }),
    );
    fireEvent.change(screen.getByLabelText('Location name'), {
      target: { value: 'Travel' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Choose folder' }));
    await screen.findByDisplayValue('/work/new');
    fireEvent.click(
      screen.getByLabelText('Use as the default location for this project'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save location' }));
    await waitFor(() =>
      expect(projects.save).toHaveBeenCalledWith({
        identity: 'first-agent',
        name: 'Travel',
        teamId: 'team',
        projectId: 'project',
        source: '/work/new',
        strategy: 'existing',
        default: true,
      }),
    );
    expect(actions.startRun).not.toHaveBeenCalled();
  });

  it('removes only the selected registration', async () => {
    const { projects } = setup([location]);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Remove Laptop' }),
    );
    await waitFor(() => expect(projects.remove).toHaveBeenCalledWith('Laptop'));
    expect(projects.save).not.toHaveBeenCalled();
  });

  it('preserves location edits when native validation rejects a save', async () => {
    const { projects } = setup();
    vi.mocked(projects.save).mockRejectedValue(
      'Choose a Git repository root with a committed revision.',
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Add local location' }),
    );
    fireEvent.change(screen.getByLabelText('Location name'), {
      target: { value: 'Travel' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Choose folder' }));
    await screen.findByDisplayValue('/work/new');
    fireEvent.click(screen.getByRole('button', { name: 'Save location' }));
    await screen.findByText(
      'Choose a Git repository root with a committed revision.',
    );
    expect(screen.getByLabelText('Location name')).toHaveValue('Travel');
    expect(screen.getByLabelText('Folder')).toHaveValue('/work/new');
  });
});
