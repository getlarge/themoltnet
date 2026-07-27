import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { AgentKeysPage } from '../src/pages/AgentKeysPage.js';

const apiMocks = vi.hoisted(() => ({
  createAgentKey: vi.fn(),
  listAgentKeys: vi.fn(),
  revokeAgentKey: vi.fn(),
  rotateAgentKey: vi.fn(),
}));

vi.mock('@moltnet/api-client', () => apiMocks);

vi.mock('@moltnet/api-client/query', () => ({
  listTeamMembersOptions: () => ({
    queryKey: ['team-members'],
    queryFn: async () => ({
      items: [
        {
          displayName: 'Agent One',
          role: 'member',
          subjectId: 'agent-1',
          subjectType: 'agent',
        },
      ],
    }),
  }),
  listAgentKeysOptions: () => ({
    queryKey: ['agent-keys'],
    queryFn: async () => ({ items: [], nextCursor: null }),
  }),
}));

vi.mock('../src/api.js', () => ({ getApiClient: () => ({}) }));
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

const originalShowModal = HTMLDialogElement.prototype.showModal;
const originalClose = HTMLDialogElement.prototype.close;

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (
    this: HTMLDialogElement,
  ) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

afterAll(() => {
  HTMLDialogElement.prototype.showModal = originalShowModal;
  HTMLDialogElement.prototype.close = originalClose;
});

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MoltThemeProvider mode="dark">
        <AgentKeysPage />
      </MoltThemeProvider>
    </QueryClientProvider>,
  );
}

describe('AgentKeysPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.listAgentKeys.mockResolvedValue({
      data: { items: [], nextCursor: null },
      error: null,
    });
  });

  it('requires explicit storage acknowledgement before clearing a new secret', async () => {
    apiMocks.createAgentKey.mockResolvedValue({
      data: {
        key: {
          id: 'key-1',
          agentId: 'agent-1',
          teamId: 'team-1',
          name: 'production-daemon',
          status: 'active',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          expiresAt: null,
          lastUsedAt: null,
          revocationReason: null,
          revocationDescription: null,
        },
        secret: 'molt_secret_once',
      },
      error: null,
    });

    renderPage();
    await screen.findByText('No matching agent keys');
    fireEvent.click(screen.getAllByRole('button', { name: 'Create key' })[0]);

    const createDialog = screen.getByRole('dialog', {
      name: 'Create agent key',
    });
    fireEvent.change(within(createDialog).getByLabelText('Key name'), {
      target: { value: 'production-daemon' },
    });
    fireEvent.click(
      within(createDialog).getByRole('button', { name: 'Create key' }),
    );

    const secretDialog = await screen.findByRole('dialog', {
      name: 'Store this secret now',
    });
    expect(within(secretDialog).getAllByText('molt_secret_once')).toHaveLength(
      2,
    );
    expect(
      within(secretDialog).queryByRole('button', { name: /close/i }),
    ).not.toBeInTheDocument();

    const done = within(secretDialog).getByRole('button', {
      name: 'Done — clear secret',
    });
    expect(done).toBeDisabled();
    fireEvent.click(
      within(secretDialog).getByRole('checkbox', {
        name: /I stored this secret/i,
      }),
    );
    expect(done).toBeEnabled();
    fireEvent.click(done);

    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Store this secret now' }),
      ).not.toBeInTheDocument(),
    );
  });
});
