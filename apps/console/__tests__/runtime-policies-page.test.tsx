import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RuntimePoliciesPage } from '../src/pages/RuntimePoliciesPage.js';

const apiMocks = vi.hoisted(() => ({
  createRuntimePolicy: vi.fn(),
  deleteRuntimePolicy: vi.fn(),
  updateRuntimePolicy: vi.fn(),
}));

vi.mock('@moltnet/api-client', () => apiMocks);
vi.mock('@moltnet/api-client/query', () => ({
  listRuntimePoliciesOptions: () => ({
    queryKey: ['runtime-policies'],
    queryFn: async () => ({ items: [] }),
  }),
  getRuntimePolicyOptions: () => ({
    queryKey: ['runtime-policy'],
    queryFn: async () => null,
  }),
}));
vi.mock('../src/api.js', () => ({ getApiClient: () => ({}) }));
vi.mock('../src/hooks/useIsMobile.js', () => ({ useIsMobile: () => false }));
vi.mock('../src/team/useTeam.js', () => ({
  useTeam: () => ({
    error: null,
    refreshTeams: vi.fn(),
    selectedTeam: {
      id: 'team-1',
      name: 'Team One',
      personal: false,
      status: 'active',
      role: 'owner',
    },
  }),
}));

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MoltThemeProvider mode="dark">
        <RuntimePoliciesPage />
      </MoltThemeProvider>
    </QueryClientProvider>,
  );
}

describe('RuntimePoliciesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a named policy with exact tool names', async () => {
    apiMocks.createRuntimePolicy.mockResolvedValue({
      data: {
        id: 'policy-1',
        teamId: 'team-1',
        name: 'field-inspector',
        description: 'Read-only inspection',
        tools: ['grep', 'read'],
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
      error: null,
    });

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'New policy' }));
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'field-inspector' },
    });
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'Read-only inspection' },
    });
    const toolInput = screen.getByLabelText('Exact tool name');
    fireEvent.change(toolInput, { target: { value: 'read' } });
    fireEvent.keyDown(toolInput, { key: 'Enter' });
    fireEvent.change(toolInput, { target: { value: 'grep' } });
    fireEvent.keyDown(toolInput, { key: 'Enter' });
    const editor = screen.getByRole('region', { name: 'New tool policy' });
    fireEvent.click(
      within(editor).getByRole('button', { name: 'Create policy' }),
    );

    await waitFor(() =>
      expect(apiMocks.createRuntimePolicy).toHaveBeenCalledWith(
        expect.objectContaining({
          body: {
            name: 'field-inspector',
            description: 'Read-only inspection',
            tools: ['read', 'grep'],
          },
        }),
      ),
    );
  });
});
