import type { AgentKey, AgentKeyWithSecret } from '@moltnet/api-client';
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
  revokeAgentKey: vi.fn(),
  rotateAgentKey: vi.fn(),
}));

const queryState = vi.hoisted(() => ({
  role: 'owner' as 'owner' | 'manager' | 'member',
  memberError: null as Error | null,
  keyError: null as Error | null,
  firstPage: { items: [] as unknown[], nextCursor: null as string | null },
  nextPage: { items: [] as unknown[], nextCursor: null as string | null },
  queryCalls: [] as Array<{
    agentId?: string;
    cursor?: string;
    status?: string;
  }>,
}));

vi.mock('@moltnet/api-client', () => apiMocks);

vi.mock('@moltnet/api-client/query', () => ({
  listTeamMembersOptions: () => ({
    queryKey: ['team-members'],
    queryFn: async () => {
      if (queryState.memberError) throw queryState.memberError;
      return {
        items: [
          {
            displayName: 'Agent One',
            role: 'member',
            subjectId: 'agent-1',
            subjectType: 'agent',
          },
        ],
      };
    },
  }),
  listAgentKeysInfiniteOptions: (options: {
    query: {
      agentId?: string;
      status?: string;
    };
  }) => ({
    queryKey: ['agent-keys', options.query],
    queryFn: async ({
      pageParam,
    }: {
      pageParam?: string | { query?: { cursor?: string } };
    }) => {
      const cursor =
        typeof pageParam === 'string' ? pageParam : pageParam?.query?.cursor;
      const query = { ...options.query, cursor };
      queryState.queryCalls.push(query);
      if (queryState.keyError) throw queryState.keyError;
      return cursor ? queryState.nextPage : queryState.firstPage;
    },
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
      role: queryState.role,
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

function makeKey(
  overrides: Partial<AgentKey> & Pick<AgentKey, 'id' | 'name'>,
): AgentKey {
  return {
    agentId: 'agent-1',
    teamId: 'team-1',
    status: 'active',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    expiresAt: null,
    lastUsedAt: null,
    revocationReason: null,
    revocationDescription: null,
    ...overrides,
  };
}

function makeSecret(
  key: AgentKey,
  secret = 'molt_secret_once',
): AgentKeyWithSecret {
  return { key, secret };
}

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

async function openCreateDialog(name = 'production-daemon') {
  await screen.findByText('No matching agent keys');
  fireEvent.click(screen.getAllByRole('button', { name: 'Create key' })[0]);
  const dialog = screen.getByRole('dialog', { name: 'Create agent key' });
  fireEvent.change(within(dialog).getByLabelText('Key name'), {
    target: { value: name },
  });
  return dialog;
}

function acknowledgeSecret(dialog: HTMLElement) {
  const done = within(dialog).getByRole('button', {
    name: 'Done — clear secret',
  });
  expect(done).toBeDisabled();
  fireEvent.click(
    within(dialog).getByRole('checkbox', {
      name: /I stored this secret/i,
    }),
  );
  expect(done).toBeEnabled();
  fireEvent.click(done);
}

describe('AgentKeysPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryState.role = 'owner';
    queryState.memberError = null;
    queryState.keyError = null;
    queryState.firstPage = { items: [], nextCursor: null };
    queryState.nextPage = { items: [], nextCursor: null };
    queryState.queryCalls = [];
  });

  it('requires explicit storage acknowledgement before clearing a new secret', async () => {
    const key = makeKey({ id: 'key-1', name: 'production-daemon' });
    apiMocks.createAgentKey.mockResolvedValue({
      data: makeSecret(key),
      error: null,
    });

    renderPage();
    const createDialog = await openCreateDialog();
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

    acknowledgeSecret(secretDialog);
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Store this secret now' }),
      ).not.toBeInTheDocument(),
    );
  });

  it('reuses the idempotency key when a create request is retried', async () => {
    const key = makeKey({ id: 'key-1', name: 'retry-daemon' });
    apiMocks.createAgentKey
      .mockResolvedValueOnce({
        data: undefined,
        error: { detail: 'Temporary issuance failure' },
      })
      .mockResolvedValueOnce({
        data: makeSecret(key),
        error: null,
      });

    renderPage();
    const dialog = await openCreateDialog('retry-daemon');
    const submit = within(dialog).getByRole('button', { name: 'Create key' });
    fireEvent.click(submit);
    await screen.findByText('Temporary issuance failure');
    fireEvent.click(submit);

    await screen.findByRole('dialog', { name: 'Store this secret now' });
    const firstHeaders = apiMocks.createAgentKey.mock.calls[0][0].headers;
    const secondHeaders = apiMocks.createAgentKey.mock.calls[1][0].headers;
    expect(firstHeaders['idempotency-key']).toBeTruthy();
    expect(secondHeaders['idempotency-key']).toBe(
      firstHeaders['idempotency-key'],
    );
  });

  it('rotates an active key and protects the replacement secret', async () => {
    const key = makeKey({ id: 'key-rotate', name: 'rotate-daemon' });
    queryState.firstPage = { items: [key], nextCursor: null };
    apiMocks.rotateAgentKey.mockResolvedValue({
      data: makeSecret(key, 'molt_rotated_once'),
      error: null,
    });

    renderPage();
    await screen.findByText('rotate-daemon');
    fireEvent.click(screen.getByRole('button', { name: 'Rotate' }));
    const confirm = screen.getByRole('dialog', { name: 'Rotate agent key?' });
    fireEvent.click(
      within(confirm).getByRole('button', { name: 'Rotate key' }),
    );

    const secretDialog = await screen.findByRole('dialog', {
      name: 'Store this secret now',
    });
    expect(within(secretDialog).getAllByText('molt_rotated_once')).toHaveLength(
      2,
    );
    expect(apiMocks.rotateAgentKey).toHaveBeenCalledWith(
      expect.objectContaining({ path: { keyId: 'key-rotate' } }),
    );
  });

  it('keeps the rotate dialog recoverable when rotation fails', async () => {
    const key = makeKey({ id: 'key-rotate-error', name: 'rotate-error' });
    queryState.firstPage = { items: [key], nextCursor: null };
    apiMocks.rotateAgentKey.mockResolvedValue({
      data: undefined,
      error: { detail: 'Rotation was rejected' },
    });

    renderPage();
    await screen.findByText('rotate-error');
    fireEvent.click(screen.getByRole('button', { name: 'Rotate' }));
    const dialog = screen.getByRole('dialog', { name: 'Rotate agent key?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Rotate key' }));

    expect(await screen.findByText('Rotation was rejected')).toBeVisible();
    expect(dialog).toBeVisible();
    expect(
      screen.queryByRole('dialog', { name: 'Store this secret now' }),
    ).not.toBeInTheDocument();
  });

  it('dispatches at most one rotate request per confirmation', async () => {
    const key = makeKey({ id: 'key-rotate-once', name: 'rotate-once' });
    queryState.firstPage = { items: [key], nextCursor: null };
    let finishRotation: ((value: unknown) => void) | undefined;
    apiMocks.rotateAgentKey.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishRotation = resolve;
        }),
    );

    renderPage();
    await screen.findByText('rotate-once');
    fireEvent.click(screen.getByRole('button', { name: 'Rotate' }));
    const confirm = screen.getByRole('dialog', { name: 'Rotate agent key?' });
    const rotate = within(confirm).getByRole('button', { name: 'Rotate key' });
    fireEvent.click(rotate);
    fireEvent.click(rotate);

    expect(apiMocks.rotateAgentKey).toHaveBeenCalledTimes(1);
    finishRotation?.({
      data: makeSecret(key, 'molt_rotate_once'),
      error: null,
    });
    await screen.findByRole('dialog', { name: 'Store this secret now' });
  });

  it('revokes a key with the selected typed reason and description', async () => {
    const key = makeKey({ id: 'key-revoke', name: 'revoke-daemon' });
    queryState.firstPage = { items: [key], nextCursor: null };
    apiMocks.revokeAgentKey.mockResolvedValue({
      data: undefined,
      error: null,
    });

    renderPage();
    await screen.findByText('revoke-daemon');
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    const dialog = screen.getByRole('dialog', { name: 'Revoke agent key' });
    fireEvent.change(within(dialog).getByLabelText('Reason'), {
      target: { value: 'privilege_withdrawn' },
    });
    fireEvent.change(within(dialog).getByLabelText('Description'), {
      target: { value: 'Deployment retired' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Revoke key' }));

    await waitFor(() =>
      expect(apiMocks.revokeAgentKey).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { keyId: 'key-revoke' },
          body: {
            reason: 'privilege_withdrawn',
            description: 'Deployment retired',
          },
        }),
      ),
    );
  });

  it('keeps the revoke dialog and reason when revocation fails', async () => {
    const key = makeKey({ id: 'key-revoke-error', name: 'revoke-error' });
    queryState.firstPage = { items: [key], nextCursor: null };
    apiMocks.revokeAgentKey.mockResolvedValue({
      data: undefined,
      error: { detail: 'Revocation was rejected' },
    });

    renderPage();
    await screen.findByText('revoke-error');
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    const dialog = screen.getByRole('dialog', { name: 'Revoke agent key' });
    fireEvent.change(within(dialog).getByLabelText('Reason'), {
      target: { value: 'key_compromise' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Revoke key' }));

    expect(await screen.findByText('Revocation was rejected')).toBeVisible();
    expect(dialog).toBeVisible();
    expect(within(dialog).getByLabelText('Reason')).toHaveValue(
      'key_compromise',
    );
  });

  it('separates a successful mutation from a failed list refresh', async () => {
    const key = makeKey({ id: 'key-created', name: 'refresh-warning' });
    apiMocks.createAgentKey.mockImplementation(async () => {
      queryState.keyError = new Error('refresh unavailable');
      return { data: makeSecret(key), error: null };
    });

    renderPage();
    const dialog = await openCreateDialog('refresh-warning');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create key' }));

    await screen.findByRole('dialog', { name: 'Store this secret now' });
    expect(
      await screen.findByText(/key change succeeded.*could not refresh/i),
    ).toBeVisible();
    expect(
      screen.queryByText('Failed to create agent key.'),
    ).not.toBeInTheDocument();
    expect(apiMocks.createAgentKey).toHaveBeenCalledTimes(1);
  });

  it('accumulates cursor pages and scopes list queries to filters', async () => {
    const first = makeKey({ id: 'key-first', name: 'first-daemon' });
    queryState.firstPage = {
      items: [first],
      nextCursor: 'cursor-2',
    };
    queryState.nextPage = {
      items: [first, makeKey({ id: 'key-second', name: 'second-daemon' })],
      nextCursor: null,
    };

    renderPage();
    await screen.findByText('first-daemon');
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByText('second-daemon');
    expect(screen.getAllByText('first-daemon')).toHaveLength(1);

    fireEvent.change(screen.getByLabelText('Agent'), {
      target: { value: 'agent-1' },
    });
    fireEvent.change(screen.getByLabelText('Status'), {
      target: { value: 'active' },
    });

    await waitFor(() =>
      expect(queryState.queryCalls).toContainEqual(
        expect.objectContaining({
          agentId: 'agent-1',
          status: 'active',
        }),
      ),
    );
  });

  it('keeps the lifecycle visible but read-only for team members', async () => {
    queryState.role = 'member';
    queryState.firstPage = {
      items: [makeKey({ id: 'key-readonly', name: 'readonly-daemon' })],
      nextCursor: null,
    };

    renderPage();
    await screen.findByText('readonly-daemon');

    expect(screen.getByRole('button', { name: 'Create key' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Rotate' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeDisabled();
    expect(
      screen.getByText(/changing them requires the team manage-runtime role/i),
    ).toBeInTheDocument();
    expect(apiMocks.createAgentKey).not.toHaveBeenCalled();
    expect(apiMocks.rotateAgentKey).not.toHaveBeenCalled();
    expect(apiMocks.revokeAgentKey).not.toHaveBeenCalled();
  });

  it('offers a retry when the team key list fails', async () => {
    queryState.keyError = new Error('key list unavailable');

    renderPage();
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Failed to load agent keys.')).toBeVisible();

    queryState.keyError = null;
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    await screen.findByText('No matching agent keys');
  });
});
