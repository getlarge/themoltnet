import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProfilesPage } from '../src/pages/ProfilesPage.js';

const createRuntimeProfile = vi.fn();
const updateRuntimeProfile = vi.fn();
const deleteRuntimeProfile = vi.fn();
const setRuntimeProfilePolicies = vi.fn();

vi.mock('@moltnet/api-client', () => ({
  createRuntimeProfile: (...args: unknown[]) => createRuntimeProfile(...args),
  updateRuntimeProfile: (...args: unknown[]) => updateRuntimeProfile(...args),
  deleteRuntimeProfile: (...args: unknown[]) => deleteRuntimeProfile(...args),
  setRuntimeProfilePolicies: (...args: unknown[]) =>
    setRuntimeProfilePolicies(...args),
}));

const queryState = vi.hoisted(() => ({
  role: 'owner' as 'owner' | 'manager' | 'member',
  profiles: [] as unknown[],
  policies: [] as unknown[],
  policyIds: [] as string[],
  allowedTools: [] as string[],
  allowedToolsEnforcement: 'off' as 'off' | 'watch' | 'enforce',
}));

vi.mock('@moltnet/api-client/query', () => ({
  listRuntimeProfilesOptions: () => ({
    queryKey: ['runtime-profiles'],
    queryFn: async () => ({ items: queryState.profiles }),
  }),
  listRuntimeModelsOptions: () => ({
    queryKey: ['runtime-models'],
    queryFn: async () => ({ items: [] }),
  }),
  listRuntimePoliciesOptions: () => ({
    queryKey: ['runtime-policies'],
    queryFn: async () => ({ items: queryState.policies }),
  }),
  getRuntimeProfilePoliciesOptions: () => ({
    queryKey: ['runtime-profile-policies'],
    queryFn: async () => ({ policyIds: queryState.policyIds }),
  }),
  getRuntimeProfileAllowedToolsOptions: () => ({
    queryKey: ['runtime-profile-allowed-tools'],
    queryFn: async () => ({
      allowedTools: queryState.allowedTools,
      enforcement: queryState.allowedToolsEnforcement,
    }),
  }),
}));

// Minimal RuntimeProfile shaped for profileToForm + the profile list.
function makeProfile(
  id: string,
  name: string,
  context: Array<{ slug: string; binding: string; content: string }>,
) {
  return {
    id,
    teamId: 'team-1',
    name,
    provider: 'anthropic',
    model: 'claude-opus',
    runtimeKind: 'gondolin_pi',
    description: null,
    thinkingLevel: null,
    temperature: null,
    topP: null,
    topK: null,
    maxOutputTokens: null,
    sandbox: {},
    sessionStorageMode: 'local',
    workspaceStorageMode: 'local',
    defaultWorkspaceMode: null,
    allowedWorkspaceModes: ['none', 'shared_mount', 'dedicated_worktree'],
    sessionTtlSec: 1800,
    workspaceTtlSec: 1800,
    leaseTtlSec: 300,
    heartbeatIntervalMs: 60000,
    maxBatchSize: 50,
    maxTurns: 0,
    maxBashTimeouts: 3,
    requiredEnv: [],
    requiredTools: [],
    context,
    revision: 1,
    definitionCid: 'bafytest',
    createdByAgentId: null,
    createdByHumanId: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    toolEnforcement: 'off',
  };
}

vi.mock('../src/api.js', () => ({ getApiClient: () => ({}) }));
vi.mock('../src/config.js', () => ({
  getConfig: () => ({ docsUrl: 'https://docs.example' }),
}));
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

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MoltThemeProvider mode="dark">
        <ProfilesPage />
      </MoltThemeProvider>
    </QueryClientProvider>,
  );
}

const STANDARD_ENGINEERING_SLUGS = [
  'proactive-memory-v1',
  'task-diary-discipline-v1',
  'accountable-delivery-v1',
  'judgment-diary-v1',
  'verification-and-artifacts-v1',
];

async function selectRecipe(recipeId: string) {
  const select = (await screen.findByLabelText(
    'Suggested context recipe',
  )) as HTMLSelectElement;
  fireEvent.change(select, { target: { value: recipeId } });
}

function applyRecipe() {
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
}

describe('ProfilesPage context editor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryState.role = 'owner';
    queryState.profiles = [];
    queryState.policies = [];
    queryState.policyIds = [];
    queryState.allowedTools = [];
    queryState.allowedToolsEnforcement = 'off';
  });

  it('applies a suggested recipe as ordinary editable entries', async () => {
    renderPage();
    await selectRecipe('standard-engineering@v1');
    applyRecipe();

    for (const slug of STANDARD_ENGINEERING_SLUGS) {
      expect(screen.getByDisplayValue(slug)).toBeInTheDocument();
    }
    expect(
      screen.getByText(/Added 5 entries from standard-engineering@v1\./),
    ).toBeInTheDocument();
    // Applied entries are real form inputs, not a stored preset id.
    expect(screen.getByLabelText('Context slug 1')).toHaveValue(
      'proactive-memory-v1',
    );
  });

  it('preserves existing entries and skips slugs already present', async () => {
    renderPage();
    await selectRecipe('run-eval-direct@v1');
    applyRecipe();
    expect(screen.getByDisplayValue('run-eval-direct-v1')).toBeInTheDocument();

    // Applying the same recipe again must not duplicate or overwrite the entry.
    applyRecipe();
    expect(screen.getAllByDisplayValue('run-eval-direct-v1')).toHaveLength(1);
    expect(screen.getByText(/Skipped 1 already present/)).toBeInTheDocument();
  });

  it('removes an entry back to the empty state', async () => {
    renderPage();
    await selectRecipe('run-eval-direct@v1');
    applyRecipe();

    fireEvent.click(
      screen.getByRole('button', { name: 'Remove context entry 1' }),
    );
    expect(screen.getByText(/No context entries yet\./)).toBeInTheDocument();
  });

  it('edits an entry and submits it in the create body', async () => {
    createRuntimeProfile.mockImplementation(
      async ({ body }: { body: Record<string, unknown> }) => ({
        data: { ...body, id: 'profile-1', revision: 1 },
        error: null,
      }),
    );
    renderPage();
    await selectRecipe('run-eval-direct@v1');
    applyRecipe();

    fireEvent.change(screen.getByLabelText('Context content 1'), {
      target: { value: 'Run the eval and submit in the first turn.' },
    });
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'eval-runner' },
    });
    fireEvent.change(screen.getByLabelText('Provider'), {
      target: { value: 'anthropic' },
    });
    fireEvent.change(screen.getByLabelText('Model'), {
      target: { value: 'claude-opus' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create profile' }));

    await waitFor(() => expect(createRuntimeProfile).toHaveBeenCalledTimes(1));
    const body = createRuntimeProfile.mock.calls[0][0].body as {
      context: Array<{ slug: string; binding: string; content: string }>;
    };
    expect(body.context).toEqual([
      {
        slug: 'run-eval-direct-v1',
        binding: 'prompt_prefix',
        content: 'Run the eval and submit in the first turn.',
      },
    ]);
  });

  it('discards an unsaved advanced-JSON draft when switching profiles', async () => {
    queryState.profiles = [
      makeProfile('p-a', 'profile-a', [
        { slug: 'a-entry', binding: 'prompt_prefix', content: 'A content' },
      ]),
      makeProfile('p-b', 'profile-b', [
        { slug: 'b-entry', binding: 'prompt_prefix', content: 'B content' },
      ]),
    ];
    renderPage();

    // profile-a auto-selects; type a dirty draft into its advanced JSON editor.
    await screen.findByText('profile-a');
    fireEvent.click(screen.getByText('Advanced — edit as raw JSON'));
    fireEvent.change(screen.getByLabelText('Context JSON'), {
      target: {
        value: '[{"slug":"stale","binding":"skill","content":"stale draft"}]',
      },
    });

    // Switch to profile-b: the editor must remount and drop the stale draft.
    fireEvent.click(screen.getByText('profile-b'));

    await waitFor(() => {
      const json = screen.getByLabelText('Context JSON') as HTMLTextAreaElement;
      expect(json.value).toContain('b-entry');
      expect(json.value).not.toContain('stale');
    });
  });

  it('rejects malformed JSON in the advanced editor', async () => {
    renderPage();
    await screen.findByLabelText('Suggested context recipe');

    fireEvent.click(screen.getByText('Advanced — edit as raw JSON'));
    const jsonField = screen.getByLabelText('Context JSON');
    fireEvent.change(jsonField, { target: { value: '{ not json' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply JSON' }));

    expect(screen.getByText('Context must be valid JSON.')).toBeInTheDocument();
  });

  it('applies valid JSON from the advanced editor into structured rows', async () => {
    renderPage();
    await screen.findByLabelText('Suggested context recipe');

    fireEvent.click(screen.getByText('Advanced — edit as raw JSON'));
    fireEvent.change(screen.getByLabelText('Context JSON'), {
      target: {
        value: JSON.stringify([
          { slug: 'repo-rules', binding: 'skill', content: 'Use pnpm and Nx.' },
        ]),
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply JSON' }));

    expect(screen.getByDisplayValue('repo-rules')).toBeInTheDocument();
    expect(screen.getByLabelText('Context content 1')).toHaveValue(
      'Use pnpm and Nx.',
    );
  });

  it('binds policies before updating profile enforcement', async () => {
    queryState.profiles = [makeProfile('p-a', 'profile-a', [])];
    queryState.policies = [
      {
        id: 'policy-1',
        teamId: 'team-1',
        name: 'reader',
        description: 'Read-only tools',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ];
    setRuntimeProfilePolicies.mockResolvedValue({
      data: undefined,
      error: null,
    });
    updateRuntimeProfile.mockResolvedValue({
      data: makeProfile('p-a', 'profile-a', []),
      error: null,
    });

    renderPage();

    fireEvent.click(await screen.findByRole('checkbox', { name: /reader/i }));
    fireEvent.click(screen.getByRole('radio', { name: /watch/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Save tool access' }));

    await waitFor(() =>
      expect(setRuntimeProfilePolicies).toHaveBeenCalledTimes(1),
    );
    await waitFor(() => expect(updateRuntimeProfile).toHaveBeenCalledTimes(1));
    expect(setRuntimeProfilePolicies.mock.invocationCallOrder[0]).toBeLessThan(
      updateRuntimeProfile.mock.invocationCallOrder[0],
    );
    expect(setRuntimeProfilePolicies).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { policyIds: ['policy-1'] },
      }),
    );
    expect(updateRuntimeProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { toolEnforcement: 'watch' },
      }),
    );
  });

  it('surfaces the resolved union and persisted enforcement mode', async () => {
    queryState.profiles = [
      {
        ...makeProfile('p-a', 'profile-a', []),
        toolEnforcement: 'enforce',
      },
    ];
    queryState.policies = [
      {
        id: 'policy-1',
        teamId: 'team-1',
        name: 'inspector',
        description: 'Inspection tools',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ];
    queryState.policyIds = ['policy-1'];
    queryState.allowedTools = ['grep', 'read'];
    queryState.allowedToolsEnforcement = 'enforce';

    renderPage();

    expect(
      await screen.findByRole('radio', { name: /enforce/i }),
    ).toBeChecked();
    await waitFor(() =>
      expect(
        screen.getByRole('checkbox', { name: /inspector/i }),
      ).toBeChecked(),
    );
    expect(screen.getByText('grep')).toBeVisible();
    expect(screen.getByText('read')).toBeVisible();
    expect(
      screen.getByText(/snapshotted by the next runtime session/i),
    ).toBeInTheDocument();
  });

  it('keeps tool access visible but immutable without manage-runtime', async () => {
    queryState.role = 'member';
    queryState.profiles = [makeProfile('p-a', 'profile-a', [])];
    queryState.policies = [
      {
        id: 'policy-1',
        teamId: 'team-1',
        name: 'reader',
        description: 'Read-only tools',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ];

    renderPage();

    expect(
      await screen.findByRole('checkbox', { name: /reader/i }),
    ).toBeDisabled();
    expect(screen.getByRole('radio', { name: /off/i })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Save tool access' }),
    ).toBeDisabled();
    expect(
      screen.getByText(/changing it requires the team manage-runtime role/i),
    ).toBeVisible();
  });

  it('reports partial failure when bindings save but enforcement does not', async () => {
    queryState.profiles = [makeProfile('p-a', 'profile-a', [])];
    queryState.policies = [
      {
        id: 'policy-1',
        teamId: 'team-1',
        name: 'reader',
        description: 'Read-only tools',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ];
    setRuntimeProfilePolicies.mockResolvedValue({
      data: undefined,
      error: null,
    });
    updateRuntimeProfile.mockResolvedValue({
      data: undefined,
      error: { detail: 'Enforcement update rejected' },
    });

    renderPage();
    fireEvent.click(await screen.findByRole('checkbox', { name: /reader/i }));
    fireEvent.click(screen.getByRole('radio', { name: /watch/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Save tool access' }));

    expect(
      await screen.findByText('Enforcement update rejected'),
    ).toBeVisible();
    expect(setRuntimeProfilePolicies).toHaveBeenCalledTimes(1);
    expect(updateRuntimeProfile).toHaveBeenCalledTimes(1);
  });
});
