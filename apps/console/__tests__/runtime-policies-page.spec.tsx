import type {
  RuntimePolicy,
  RuntimePolicyWithTools,
} from '@moltnet/api-client';
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

const queryState = vi.hoisted(() => ({
  role: 'owner' as 'owner' | 'manager' | 'member',
  listError: null as Error | null,
  detailError: null as Error | null,
  policies: [] as unknown[],
  policyDetails: new Map<string, unknown>(),
}));

vi.mock('@moltnet/api-client', () => apiMocks);
vi.mock('@moltnet/api-client/query', () => ({
  listRuntimePoliciesOptions: () => ({
    queryKey: ['runtime-policies'],
    queryFn: async () => {
      if (queryState.listError) throw queryState.listError;
      return { items: queryState.policies };
    },
  }),
  getRuntimePolicyOptions: (options: { path: { policyId: string } }) => ({
    queryKey: ['runtime-policy', options.path.policyId],
    queryFn: async () => {
      if (queryState.detailError) throw queryState.detailError;
      return queryState.policyDetails.get(options.path.policyId) ?? null;
    },
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
      role: queryState.role,
    },
  }),
}));

function makePolicy(
  overrides: Partial<RuntimePolicyWithTools> &
    Pick<RuntimePolicyWithTools, 'id' | 'name'>,
): RuntimePolicyWithTools {
  return {
    teamId: 'team-1',
    description: null,
    tools: [],
    shellCommands: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function setPolicies(...policies: RuntimePolicyWithTools[]) {
  queryState.policies = policies.map(
    ({ tools: _tools, ...summary }): RuntimePolicy => summary,
  );
  queryState.policyDetails = new Map(
    policies.map((policy) => [policy.id, policy]),
  );
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <MoltThemeProvider mode="dark">
          <RuntimePoliciesPage />
        </MoltThemeProvider>
      </QueryClientProvider>,
    ),
  };
}

describe('RuntimePoliciesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryState.role = 'owner';
    queryState.listError = null;
    queryState.detailError = null;
    setPolicies();
  });

  it('creates a named policy with exact tool names', async () => {
    apiMocks.createRuntimePolicy.mockResolvedValue({
      data: makePolicy({
        id: 'policy-1',
        name: 'field-inspector',
        description: 'Read-only inspection',
        tools: ['grep', 'read'],
      }),
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
    const toolInput = screen.getByLabelText('Tool name');
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
            shellCommands: [],
          },
        }),
      ),
    );
  });

  it('builds an ordered shell command rule', async () => {
    apiMocks.createRuntimePolicy.mockResolvedValue({
      data: makePolicy({ id: 'policy-2', name: 'reviewer' }),
      error: null,
    });

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'New policy' }));
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'reviewer' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add shell command' }));
    fireEvent.change(screen.getByLabelText('Program'), {
      target: { value: 'gh' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add token' }));
    fireEvent.change(screen.getByLabelText('Subcommand'), {
      target: { value: 'pr' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add token' }));
    fireEvent.change(screen.getByLabelText('Token 3'), {
      target: { value: 'view' },
    });
    expect(screen.getByText('gh › pr › view › …')).toBeVisible();

    const editor = screen.getByRole('region', { name: 'New tool policy' });
    fireEvent.click(
      within(editor).getByRole('button', { name: 'Create policy' }),
    );
    await waitFor(() =>
      expect(apiMocks.createRuntimePolicy).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            shellCommands: [{ argvPrefix: ['gh', 'pr', 'view'] }],
          }),
        }),
      ),
    );
  });

  it('describes tools and shell commands as separate grants', async () => {
    // Arrange
    renderPage();

    // Act
    fireEvent.click(await screen.findByRole('button', { name: 'New policy' }));

    // Assert
    expect(
      screen.getByText('Runtime and MCP tools this policy allows, by name.'),
    ).toBeVisible();
    expect(
      screen.getByText(
        'Shell commands this policy allows, matched from the program name onward. Output redirection is never allowed.',
      ),
    ).toBeVisible();
    expect(
      screen.queryByText(/authorize every shell invocation/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/same name/i)).not.toBeInTheDocument();
  });

  it('creates a one-token shell command rule', async () => {
    // Arrange
    apiMocks.createRuntimePolicy.mockResolvedValue({
      data: makePolicy({ id: 'policy-git', name: 'git-access' }),
      error: null,
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'New policy' }));
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'git-access' },
    });

    // Act
    fireEvent.click(screen.getByRole('button', { name: 'Add shell command' }));
    fireEvent.change(screen.getByLabelText('Program'), {
      target: { value: 'git' },
    });
    expect(screen.queryByLabelText('Subcommand')).not.toBeInTheDocument();
    expect(screen.getByText('git › …')).toBeVisible();
    const editor = screen.getByRole('region', { name: 'New tool policy' });
    const create = within(editor).getByRole('button', {
      name: 'Create policy',
    });
    expect(create).toBeEnabled();
    fireEvent.click(create);

    // Assert
    await waitFor(() =>
      expect(apiMocks.createRuntimePolicy).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            shellCommands: [{ argvPrefix: ['git'] }],
          }),
        }),
      ),
    );
  });

  it('removes a subcommand token down to a one-token rule', async () => {
    // Arrange
    setPolicies(
      makePolicy({
        id: 'policy-diff',
        name: 'differ',
        shellCommands: [{ argvPrefix: ['git', 'diff'] }],
      }),
    );
    renderPage();
    await screen.findByDisplayValue('differ');

    // Act
    fireEvent.click(screen.getByRole('button', { name: 'Remove token' }));

    // Assert
    expect(screen.getByText('git › …')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save policy' })).toBeEnabled();
  });

  it('does not claim a shell rule is covered by a same-named tool grant', async () => {
    // Arrange
    setPolicies(
      makePolicy({
        id: 'policy-overlap',
        name: 'overlap',
        tools: ['git', 'ls'],
        shellCommands: [
          { argvPrefix: ['git', 'diff'] },
          { argvPrefix: ['ls', '-l'] },
        ],
      }),
    );

    // Act
    renderPage();
    await screen.findByDisplayValue('overlap');

    // Assert
    expect(screen.getByText('git › diff › …')).toBeVisible();
    expect(screen.getByText('ls › -l › …')).toBeVisible();
    expect(screen.queryByText(/redundant/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/already permits/i)).not.toBeInTheDocument();
  });

  it('updates metadata using exact add/remove tool deltas', async () => {
    const policy = makePolicy({
      id: 'policy-update',
      name: 'reader',
      description: 'Original',
      tools: ['read', 'grep'],
    });
    setPolicies(policy);
    apiMocks.updateRuntimePolicy.mockResolvedValue({
      data: makePolicy({
        ...policy,
        name: 'inspector',
        description: 'Updated',
        tools: ['grep', 'shell'],
      }),
      error: null,
    });

    const { client } = renderPage();
    const allowedToolsKey = [
      {
        _id: 'getRuntimeProfileAllowedTools',
        path: { profileId: 'profile-1' },
      },
    ] as const;
    client.setQueryData(allowedToolsKey, { allowedTools: ['read'] });
    await screen.findByDisplayValue('reader');
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'inspector' },
    });
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'Updated' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Remove read' }));
    fireEvent.change(screen.getByLabelText('Tool name'), {
      target: { value: 'shell' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add tool' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save policy' }));

    await waitFor(() =>
      expect(apiMocks.updateRuntimePolicy).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { policyId: 'policy-update' },
          body: {
            name: 'inspector',
            description: 'Updated',
            addTools: ['shell'],
            removeTools: ['read'],
            addShellCommands: [],
            removeShellCommands: [],
          },
        }),
      ),
    );
    await waitFor(() =>
      expect(client.getQueryState(allowedToolsKey)?.isInvalidated).toBe(true),
    );
  });

  it('requires confirmation before deleting a policy', async () => {
    setPolicies(makePolicy({ id: 'policy-delete', name: 'obsolete' }));
    apiMocks.deleteRuntimePolicy.mockResolvedValue({
      data: undefined,
      error: null,
    });

    renderPage();
    await screen.findByDisplayValue('obsolete');
    fireEvent.click(screen.getByRole('button', { name: 'Delete policy' }));
    const dialog = screen.getByRole('dialog', {
      name: 'Delete tool policy?',
    });
    expect(
      within(dialog).getByText(/profile bound to it will lose/i),
    ).toBeVisible();
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Delete policy' }),
    );

    await waitFor(() =>
      expect(apiMocks.deleteRuntimePolicy).toHaveBeenCalledWith(
        expect.objectContaining({ path: { policyId: 'policy-delete' } }),
      ),
    );
  });

  it('selects from the refreshed list only after a policy is deleted', async () => {
    const deleted = makePolicy({ id: 'policy-delete', name: 'obsolete' });
    const remaining = makePolicy({ id: 'policy-keep', name: 'keeper' });
    setPolicies(deleted, remaining);
    apiMocks.deleteRuntimePolicy.mockImplementation(async () => {
      setPolicies(remaining);
      return { data: undefined, error: null };
    });

    renderPage();
    await screen.findByDisplayValue('obsolete');
    fireEvent.click(screen.getByRole('button', { name: 'Delete policy' }));
    fireEvent.click(
      within(
        screen.getByRole('dialog', { name: 'Delete tool policy?' }),
      ).getByRole('button', { name: 'Delete policy' }),
    );

    expect(await screen.findByDisplayValue('keeper')).toBeVisible();
    expect(screen.queryByDisplayValue('obsolete')).not.toBeInTheDocument();
  });

  it('keeps policy definitions visible but read-only for team members', async () => {
    queryState.role = 'member';
    setPolicies(
      makePolicy({
        id: 'policy-readonly',
        name: 'readonly',
        tools: ['read'],
      }),
    );

    renderPage();
    await screen.findByDisplayValue('readonly');

    expect(screen.getByRole('button', { name: 'New policy' })).toBeDisabled();
    expect(screen.getByLabelText('Name')).toBeDisabled();
    expect(screen.getByLabelText('Description')).toBeDisabled();
    expect(screen.getByLabelText('Tool name')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove read' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save policy' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Delete policy' }),
    ).toBeDisabled();
    expect(
      screen.getByText(/changing them requires the team manage-runtime role/i),
    ).toBeVisible();
    expect(apiMocks.createRuntimePolicy).not.toHaveBeenCalled();
    expect(apiMocks.updateRuntimePolicy).not.toHaveBeenCalled();
    expect(apiMocks.deleteRuntimePolicy).not.toHaveBeenCalled();
  });

  it('surfaces API errors without discarding the policy draft', async () => {
    setPolicies(makePolicy({ id: 'policy-error', name: 'reader' }));
    apiMocks.updateRuntimePolicy.mockResolvedValue({
      data: undefined,
      error: { detail: 'Policy name already exists' },
    });

    renderPage();
    await screen.findByDisplayValue('reader');
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'duplicate' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save policy' }));

    await screen.findByText('Policy name already exists');
    expect(screen.getByLabelText('Name')).toHaveValue('duplicate');
  });

  it('offers a retry when the policy list fails', async () => {
    queryState.listError = new Error('policy list unavailable');

    renderPage();
    const alert = await screen.findByRole('alert');
    expect(
      within(alert).getByText('Failed to load tool policies.'),
    ).toBeVisible();

    queryState.listError = null;
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    await screen.findByText('No tool policies yet');
  });

  it('surfaces a policy-detail failure and supports retry', async () => {
    setPolicies(makePolicy({ id: 'policy-detail', name: 'reader' }));
    queryState.detailError = new Error('details unavailable');

    renderPage();
    const alert = await screen.findByRole('alert');
    expect(
      within(alert).getByText('Failed to load tool policy details.'),
    ).toBeVisible();

    queryState.detailError = null;
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByDisplayValue('reader')).toBeVisible();
  });
});
