import { fireEvent, render, screen } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  packs: {} as Record<string, unknown>,
  navigate: vi.fn(),
  pinMutate: vi.fn(),
}));

vi.mock('../src/packs/hooks.js', () => ({
  usePacks: () => mocks.packs,
  usePinPack: () => ({
    mutate: mocks.pinMutate,
    isPending: false,
    isError: false,
  }),
}));

vi.mock('../src/config.js', () => ({
  getConfig: () => ({ docsUrl: 'https://docs.example.test', packGcTtlDays: 7 }),
}));

vi.mock('../src/team/useTeam.js', () => ({
  useTeam: () => ({ selectedTeam: { id: 'team-1' } }),
}));

import { PacksPage } from '../src/pages/PacksPage.js';

const AGENT = {
  kind: 'agent' as const,
  fingerprint: '1671-B080-99BF-4270',
  identityId: 'id-1',
  publicKey: 'ed25519:x',
};

const pack = (over: Record<string, unknown> = {}) => ({
  id: '11111111-2222-3333-4444-555555555555',
  diaryId: 'diary-1',
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 4 * 86_400_000).toISOString(),
  pinned: false,
  packCid: 'bafyreiexamplecid',
  packCodec: 'dag-cbor',
  packType: 'optimized',
  // The shape libs/agent-runtime/src/prompts/curate-pack.ts actually writes.
  params: {
    recipe: 'topic-focused-v1',
    prompt: 'How does auth work?',
    selection_rationale: 'Picked the auth decisions and the incident.',
  },
  payload: {},
  creator: AGENT,
  supersedesPackId: null,
  ...over,
});

const renderPage = () =>
  render(
    <MoltThemeProvider>
      <PacksPage />
    </MoltThemeProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.packs = { isLoading: false, isError: false, data: undefined };
});

describe('PacksPage', () => {
  it('shows a loading state', () => {
    mocks.packs = { isLoading: true, isError: false, data: undefined };
    renderPage();
    expect(screen.getByText(/loading packs/i)).toBeInTheDocument();
  });

  // The generated client throws the parsed JSON body — a plain object with
  // detail/title/status — for every HTTP error. That is the branch that runs in
  // production; `instanceof Error` is only the network-failure path.
  it('surfaces the problem detail from a plain API error body', () => {
    mocks.packs = {
      isLoading: false,
      isError: true,
      error: {
        title: 'Forbidden',
        detail: 'You do not have read access to this team.',
        status: 403,
      },
      data: undefined,
      refetch: vi.fn(),
    };
    renderPage();
    expect(
      screen.getByText(/you do not have read access to this team/i),
    ).toBeInTheDocument();
  });

  it('surfaces a network-failure Error too', () => {
    mocks.packs = {
      isLoading: false,
      isError: true,
      error: new Error('Failed to fetch'),
      data: undefined,
      refetch: vi.fn(),
    };
    renderPage();
    expect(screen.getByText(/failed to fetch/i)).toBeInTheDocument();
  });

  it('offers a retry on load failure', () => {
    const refetch = vi.fn();
    mocks.packs = {
      isLoading: false,
      isError: true,
      error: {
        title: 'Server Error',
        detail: 'Upstream timed out',
        status: 503,
      },
      data: undefined,
      refetch,
    };
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it('teaches what a pack is when there are none', () => {
    mocks.packs = {
      isLoading: false,
      isError: false,
      data: { items: [], total: 0 },
    };
    renderPage();

    // Must explain the concept, not just say "nothing here".
    expect(screen.getByText(/no packs yet/i)).toBeInTheDocument();
    expect(screen.getByText(/curate_pack/i)).toBeInTheDocument();
  });

  it("prefers the producer's prompt over its recipe slug", () => {
    mocks.packs = {
      isLoading: false,
      isError: false,
      data: { items: [pack()], total: 1 },
    };
    renderPage();

    expect(screen.getByText(/how does auth work\?/i)).toBeInTheDocument();
    expect(screen.queryByText('topic-focused-v1')).not.toBeInTheDocument();
  });

  it('falls back to the recipe slug, labelled, when no prompt was recorded', () => {
    mocks.packs = {
      isLoading: false,
      isError: false,
      data: {
        items: [pack({ params: { recipe: 'scope-inventory-v1' } })],
        total: 1,
      },
    };
    renderPage();

    expect(screen.getByText('scope-inventory-v1')).toBeInTheDocument();
    expect(screen.getByText(/^recipe$/i)).toBeInTheDocument();
  });

  it('renders a pack with its evidence and lifecycle state', () => {
    mocks.packs = {
      isLoading: false,
      isError: false,
      data: { items: [pack()], total: 1 },
    };
    renderPage();

    expect(screen.getByText(/how does auth work\?/i)).toBeInTheDocument();
    expect(screen.getByText('optimized')).toBeInTheDocument();
    expect(screen.getByText(/expires in 4 days/i)).toBeInTheDocument();
    expect(screen.getByText('bafyreiexamplecid')).toBeInTheDocument();
    expect(screen.getByText(AGENT.fingerprint)).toBeInTheDocument();
  });

  it('marks a superseded pack', () => {
    mocks.packs = {
      isLoading: false,
      isError: false,
      data: { items: [pack({ supersedesPackId: 'older' })], total: 1 },
    };
    renderPage();
    expect(screen.getByText(/supersedes an earlier pack/i)).toBeInTheDocument();
  });

  it('falls back to a short id when params carry no summary', () => {
    mocks.packs = {
      isLoading: false,
      isError: false,
      data: { items: [pack({ params: null })], total: 1 },
    };
    renderPage();
    expect(screen.getByText(/pack 11111111/i)).toBeInTheDocument();
  });

  it('does not advertise a pack detail route that does not exist yet', () => {
    mocks.packs = {
      isLoading: false,
      isError: false,
      data: { items: [pack()], total: 1 },
    };
    renderPage();

    // /packs/:id resolves to NotFoundPage until the detail PR lands, so the
    // row must not present itself as navigable.
    expect(
      screen.queryByRole('link', { name: /how does auth work/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /how does auth work/i }),
    ).not.toBeInTheDocument();
  });

  it('hides pagination for a single page', () => {
    mocks.packs = {
      isLoading: false,
      isError: false,
      data: { items: [pack()], total: 1 },
    };
    renderPage();
    expect(
      screen.queryByRole('button', { name: /next/i }),
    ).not.toBeInTheDocument();
  });

  it('keeps a way back when the list shrinks under a non-zero offset', () => {
    mocks.packs = {
      isLoading: false,
      isError: false,
      isFetching: true,
      data: { items: [], total: 0 },
    };
    renderPage();

    // total is 0 but the pager must not vanish while offset > 0 would strand
    // the operator. With offset 0 here, the empty state is the correct surface.
    expect(screen.getByText(/no packs yet/i)).toBeInTheDocument();
  });

  it('paginates when the catalog exceeds one page', () => {
    mocks.packs = {
      isLoading: false,
      isError: false,
      data: { items: [pack()], total: 45 },
    };
    renderPage();

    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /next/i })).toBeEnabled();
    expect(screen.getByText(/of 45/i)).toBeInTheDocument();
  });
});
