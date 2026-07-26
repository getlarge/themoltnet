import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProfilesPage } from '../src/pages/ProfilesPage.js';

const createRuntimeProfile = vi.fn();
const updateRuntimeProfile = vi.fn();
const deleteRuntimeProfile = vi.fn();

vi.mock('@moltnet/api-client', () => ({
  createRuntimeProfile: (...args: unknown[]) => createRuntimeProfile(...args),
  updateRuntimeProfile: (...args: unknown[]) => updateRuntimeProfile(...args),
  deleteRuntimeProfile: (...args: unknown[]) => deleteRuntimeProfile(...args),
}));

vi.mock('@moltnet/api-client/query', () => ({
  listRuntimeProfilesOptions: () => ({
    queryKey: ['runtime-profiles'],
    queryFn: async () => ({ items: [] }),
  }),
  listRuntimeModelsOptions: () => ({
    queryKey: ['runtime-models'],
    queryFn: async () => ({ items: [] }),
  }),
}));

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
});
