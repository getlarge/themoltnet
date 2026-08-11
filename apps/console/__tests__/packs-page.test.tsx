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

vi.mock('wouter', () => ({
  useLocation: () => ['/packs', mocks.navigate],
}));

vi.mock('../src/config.js', () => ({
  getConfig: () => ({ docsUrl: 'https://docs.example.test' }),
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
  params: { taskPrompt: 'How does auth work?' },
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

  it('surfaces the API problem detail on error', () => {
    mocks.packs = {
      isLoading: false,
      isError: true,
      error: new Error('Forbidden for this team'),
      data: undefined,
    };
    renderPage();
    expect(screen.getByText(/forbidden for this team/i)).toBeInTheDocument();
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

  it('opens the pack detail on click', () => {
    mocks.packs = {
      isLoading: false,
      isError: false,
      data: { items: [pack()], total: 1 },
    };
    renderPage();

    fireEvent.click(screen.getByText(/how does auth work\?/i));

    expect(mocks.navigate).toHaveBeenCalledWith(
      '/packs/11111111-2222-3333-4444-555555555555',
    );
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
