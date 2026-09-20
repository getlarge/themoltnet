import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import { beforeEach, expect, it, vi } from 'vitest';

import { ProjectsPage } from '../src/pages/ProjectsPage.js';

const api = vi.hoisted(() => ({
  listProjects: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  listDiaries: vi.fn(),
  role: 'owner',
  hasTeam: true,
}));
vi.mock('@moltnet/api-client', () => api);
vi.mock('@moltnet/api-client/query', () => {
  const key = (options: { headers: object; query?: object }) => [
    {
      _id: 'listProjects',
      headers: options.headers,
      ...(options.query ? { query: options.query } : {}),
    },
  ];
  const data = async (result: Promise<{ data?: unknown; error?: unknown }>) => {
    const response = await result;
    if (response.error) throw response.error;
    return response.data;
  };
  return {
    listProjectsQueryKey: key,
    listProjectsOptions: (options: { headers: object; query?: object }) => ({
      queryKey: key(options),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        data(api.listProjects({ ...options, signal })),
    }),
    listDiariesOptions: (options: { headers: object }) => ({
      queryKey: ['diaries', options.headers],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        data(api.listDiaries({ ...options, signal })),
    }),
    createProjectMutation: () => ({
      mutationFn: (options: unknown) => data(api.createProject(options)),
    }),
    updateProjectMutation: () => ({
      mutationFn: (options: unknown) => data(api.updateProject(options)),
    }),
  };
});
vi.mock('../src/api.js', () => ({ getApiClient: () => ({}) }));
vi.mock('../src/team/useTeam.js', () => ({
  useTeam: () => ({
    selectedTeam: api.hasTeam
      ? { id: 'team', name: 'Team', role: api.role }
      : null,
  }),
}));
beforeEach(() => {
  api.role = 'owner';
  api.hasTeam = true;
  api.listDiaries
    .mockReset()
    .mockResolvedValue({ data: { items: [{ id: 'diary', name: 'Notes' }] } });
  api.listProjects.mockReset().mockResolvedValue({ data: { items: [] } });
  api.createProject.mockReset().mockResolvedValue({ data: { id: 'project' } });
  api.updateProject.mockReset().mockResolvedValue({ data: { id: 'project' } });
});
function show() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MoltThemeProvider mode="dark">
        <ProjectsPage />
      </MoltThemeProvider>
    </QueryClientProvider>,
  );
}
it('creates a project with the selected team and diary', async () => {
  show();
  fireEvent.click(screen.getByRole('button', { name: 'Create project' }));
  fireEvent.change(screen.getByLabelText('Project name'), {
    target: { value: 'Research' },
  });
  await screen.findByRole('option', { name: 'Notes' });
  fireEvent.change(screen.getByLabelText('Default diary'), {
    target: { value: 'diary' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save project' }));
  await waitFor(() =>
    expect(api.createProject).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: { 'x-moltnet-team-id': 'team' },
        body: { name: 'Research', description: null, defaultDiaryId: 'diary' },
      }),
    ),
  );
  expect(api.createProject.mock.calls[0][0]).not.toHaveProperty('path');
  expect(api.listProjects.mock.calls[0][0]).not.toHaveProperty('path');
});
it('shows members the catalogue without management actions', async () => {
  api.role = 'member';
  api.listProjects.mockResolvedValue({
    data: {
      items: [
        {
          id: 'project',
          name: 'Research',
          description: 'Reports',
          archived: false,
          defaultDiaryId: null,
        },
      ],
    },
  });
  show();
  expect(await screen.findByText('Research')).toBeDefined();
  expect(screen.queryByRole('button', { name: 'Create project' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Archive Research' })).toBeNull();
});
it('surfaces failed requests and lets the operator retry', async () => {
  api.listProjects.mockRejectedValue(new Error('offline'));
  show();
  expect(await screen.findByRole('alert')).toBeDefined();
  api.listProjects.mockResolvedValue({ data: { items: [] } });
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(
    await screen.findByText('No projects in this team yet.'),
  ).toBeDefined();
});

it('preserves an unavailable default diary when editing other project fields', async () => {
  api.listProjects.mockResolvedValue({
    data: {
      items: [
        {
          id: 'project',
          name: 'Research',
          description: null,
          archived: false,
          defaultDiaryId: 'unavailable',
        },
      ],
    },
  });
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Research' }));
  expect(
    screen.getByRole('option', { name: 'Unavailable default diary' }),
  ).toBeDefined();
  fireEvent.change(screen.getByLabelText('Project name'), {
    target: { value: 'Research updated' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save project' }));
  await waitFor(() =>
    expect(api.updateProject).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { name: 'Research updated' },
      }),
    ),
  );
});

it('restores focus to the create action after cancelling', () => {
  show();
  const create = screen.getByRole('button', { name: 'Create project' });
  fireEvent.click(create);
  const cancel = screen.getByRole('button', { name: 'Cancel' });
  cancel.focus();
  fireEvent.click(cancel);
  expect(document.activeElement).toBe(create);
});
it('explains diary loading failures and retries only the catalogue', async () => {
  api.listDiaries.mockRejectedValue(new Error('offline'));
  show();
  fireEvent.click(screen.getByRole('button', { name: 'Create project' }));
  expect(await screen.findByText('offline')).toBeDefined();
  api.listDiaries.mockResolvedValue({
    data: { items: [{ id: 'diary', name: 'Notes' }] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Retry diaries' }));
  expect(await screen.findByRole('option', { name: 'Notes' })).toBeDefined();
});

it('navigates project pages and resets pagination when filtering archives', async () => {
  api.listProjects.mockImplementation(async ({ query }) => ({
    data: {
      items: [
        {
          id: String(query.offset ?? 0),
          name: query.offset ? 'Second page' : 'First page',
          archived: false,
          defaultDiaryId: null,
        },
      ],
      nextOffset: query.offset ? null : 50,
    },
  }));
  show();
  await screen.findByText('First page');
  await waitFor(() =>
    expect(
      screen
        .getByRole('button', { name: 'Next projects' })
        .getAttribute('aria-disabled') === 'true',
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Next projects' }));
  await screen.findByText('Second page');
  expect(api.listProjects).toHaveBeenLastCalledWith(
    expect.objectContaining({
      query: { includeArchived: false, limit: 50, offset: 50 },
    }),
  );
  expect(
    screen
      .getByRole('button', { name: 'Next projects' })
      .getAttribute('aria-disabled') === 'true',
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Previous projects' }));
  await screen.findByText('First page');
  await waitFor(() =>
    expect(
      screen
        .getByRole('button', { name: 'Next projects' })
        .getAttribute('aria-disabled') === 'true',
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Next projects' }));
  await screen.findByText('Second page');
  fireEvent.click(screen.getByLabelText('Show archived projects'));
  await screen.findByText('First page');
  expect(api.listProjects).toHaveBeenLastCalledWith(
    expect.objectContaining({
      query: { includeArchived: true, limit: 50, offset: 0 },
    }),
  );
});

it('shows duplicate-name details on the field and preserves entered values', async () => {
  api.createProject.mockResolvedValue({
    error: { status: 409, detail: 'That project name is already reserved.' },
  });
  show();
  fireEvent.click(screen.getByRole('button', { name: 'Create project' }));
  const name = screen.getByLabelText('Project name');
  fireEvent.change(name, { target: { value: 'Research' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save project' }));
  await screen.findByText('That project name is already reserved.');
  expect((name as HTMLInputElement).value).toBe('Research');
  expect(name.getAttribute('aria-invalid')).toBe('true');
  expect(name.getAttribute('aria-describedby')).toBeTruthy();
  await waitFor(() => expect(document.activeElement).toBe(name));
});
it('validates a whitespace-only name on its field', async () => {
  show();
  fireEvent.click(screen.getByRole('button', { name: 'Create project' }));
  const name = screen.getByLabelText('Project name');
  fireEvent.change(name, { target: { value: '   ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save project' }));
  await screen.findByText('Enter a project name.');
  expect(name.getAttribute('aria-invalid')).toBe('true');
  expect(api.createProject).not.toHaveBeenCalled();
});
it('archives and restores as a manager', async () => {
  const project = {
    id: 'project',
    name: 'Research',
    archived: false,
    description: null,
    defaultDiaryId: null,
  };
  api.listProjects.mockImplementation(async () => ({
    data: { items: [project] },
  }));
  api.updateProject.mockImplementation(async ({ body }) => {
    project.archived = body.archived;
    return { data: project };
  });
  show();
  fireEvent.click(
    await screen.findByRole('button', { name: 'Archive Research' }),
  );
  await screen.findByRole('button', { name: 'Restore Research' });
  expect(api.updateProject).toHaveBeenLastCalledWith(
    expect.objectContaining({
      path: { projectId: 'project' },
      headers: { 'x-moltnet-team-id': 'team' },
      body: { archived: true },
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Restore Research' }));
  await screen.findByRole('button', { name: 'Archive Research' });
  expect(api.updateProject).toHaveBeenLastCalledWith(
    expect.objectContaining({ body: { archived: false } }),
  );
});
it('disables diary selection when its catalogue fails', async () => {
  api.listDiaries.mockRejectedValue(new Error('Diary catalogue offline'));
  show();
  fireEvent.click(screen.getByRole('button', { name: 'Create project' }));
  await screen.findByRole('button', { name: 'Retry diaries' });
  expect(
    (screen.getByLabelText('Default diary') as HTMLSelectElement).disabled,
  ).toBe(true);
});
it('keeps cached projects visible when a refetch fails', async () => {
  api.listProjects
    .mockResolvedValueOnce({
      data: {
        items: [
          {
            id: 'project',
            name: 'Research',
            archived: false,
            description: null,
            defaultDiaryId: null,
          },
        ],
      },
    })
    .mockRejectedValue(new Error('Refetch offline'));
  show();
  fireEvent.click(
    await screen.findByRole('button', { name: 'Archive Research' }),
  );
  await screen.findByRole('alert');
  expect(screen.getByText('Research')).toBeDefined();
});

it('does not load a catalogue without a selected team', () => {
  api.hasTeam = false;
  show();
  expect(
    screen.getByText('Select a team to browse its projects.'),
  ).toBeDefined();
  expect(api.listProjects).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Create project' })).toBeNull();
});
it('prevents duplicate submissions while saving', async () => {
  let finish!: (value: unknown) => void;
  api.createProject.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  show();
  fireEvent.click(screen.getByRole('button', { name: 'Create project' }));
  fireEvent.change(screen.getByLabelText('Project name'), {
    target: { value: 'Research' },
  });
  const form = screen
    .getByRole('button', { name: 'Save project' })
    .closest('form')!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  await waitFor(() => expect(api.createProject).toHaveBeenCalledTimes(1));
  finish({ data: { id: 'project' } });
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Save project' })).toBeNull(),
  );
});
it('restores focus to the row after an archive failure', async () => {
  api.listProjects.mockResolvedValue({
    data: { items: [{ id: 'project', name: 'Research', archived: false }] },
  });
  api.updateProject.mockResolvedValue({
    error: { status: 403, detail: 'Team management is required.' },
  });
  show();
  const action = await screen.findByRole('button', {
    name: 'Archive Research',
  });
  action.focus();
  fireEvent.click(action);
  await screen.findByText('Team management is required.');
  await waitFor(() => expect(document.activeElement).toBe(action));
});
it('focuses the catalogue after archiving removes its row', async () => {
  api.listProjects
    .mockResolvedValueOnce({
      data: { items: [{ id: 'project', name: 'Research', archived: false }] },
    })
    .mockResolvedValue({ data: { items: [] } });
  show();
  const action = await screen.findByRole('button', {
    name: 'Archive Research',
  });
  action.focus();
  fireEvent.click(action);
  await screen.findByText('No projects in this team yet.');
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole('heading', { name: 'Project catalogue' }),
    ),
  );
});
