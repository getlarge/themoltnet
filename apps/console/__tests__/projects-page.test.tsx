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
}));
vi.mock('@moltnet/api-client', () => api);
vi.mock('../src/api.js', () => ({ getApiClient: () => ({}) }));
vi.mock('../src/team/useTeam.js', () => ({
  useTeam: () => ({
    selectedTeam: { id: 'team', name: 'Team', role: api.role },
  }),
}));
beforeEach(() => {
  api.role = 'owner';
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
        path: { id: 'team' },
        body: { name: 'Research', description: null, defaultDiaryId: 'diary' },
      }),
    ),
  );
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
  expect(await screen.findByText('Diaries could not be loaded.')).toBeDefined();
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
        .hasAttribute('disabled'),
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
      .hasAttribute('disabled'),
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Previous projects' }));
  await screen.findByText('First page');
  await waitFor(() =>
    expect(
      screen
        .getByRole('button', { name: 'Next projects' })
        .hasAttribute('disabled'),
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
