import { fireEvent, render, screen } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  pack: {} as Record<string, unknown>,
}));

vi.mock('../src/packs/hooks.js', () => ({
  usePack: () => mocks.pack,
  usePinPack: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
}));

vi.mock('../src/config.js', () => ({
  getConfig: () => ({ docsUrl: 'https://docs.example.test', packGcTtlDays: 7 }),
}));

import { PackDetailPage } from '../src/pages/PackDetailPage.js';

const AGENT = {
  kind: 'agent' as const,
  fingerprint: '1671-B080-99BF-4270',
  identityId: 'id-1',
  publicKey: 'ed25519:x',
};

const PACK_ID = '11111111-2222-3333-4444-555555555555';

const pack = (over: Record<string, unknown> = {}) => ({
  id: PACK_ID,
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
      <PackDetailPage id={PACK_ID} />
    </MoltThemeProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pack = { isLoading: false, isError: false, data: undefined };
});

describe('PackDetailPage', () => {
  it('announces the loading state rather than rendering a bare text node', () => {
    mocks.pack = { isLoading: true, isError: false, data: undefined };
    renderPage();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('titles the page with the pack prompt', () => {
    mocks.pack = { isLoading: false, isError: false, data: pack() };
    renderPage();
    expect(
      screen.getByRole('heading', { name: /How does auth work\?/ }),
    ).toBeInTheDocument();
  });

  it('falls back to a short id when params carry no summary', () => {
    mocks.pack = {
      isLoading: false,
      isError: false,
      data: pack({ params: null }),
    };
    renderPage();
    expect(
      screen.getByRole('heading', { name: /Pack 11111111/ }),
    ).toBeInTheDocument();
  });

  it('surfaces the API problem detail on error', () => {
    // The generated client throws the parsed body, not an Error instance.
    mocks.pack = {
      isLoading: false,
      isError: true,
      error: { detail: 'Forbidden for this team', title: 'Forbidden' },
      data: undefined,
    };
    renderPage();
    expect(screen.getByText('Forbidden for this team')).toBeInTheDocument();
  });

  it('recovers from a load failure by refetching', () => {
    const refetch = vi.fn();
    mocks.pack = {
      isLoading: false,
      isError: true,
      error: { detail: 'Upstream timeout' },
      data: undefined,
      refetch,
    };
    renderPage();

    // Asserting only that the button exists would stay green if the handler
    // were removed, leaving the error state unrecoverable.
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));

    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('renders the lifecycle state and the pin control for the pack', () => {
    mocks.pack = { isLoading: false, isError: false, data: pack() };
    renderPage();
    expect(screen.getByText(/Expires in 4 days/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /keep this pack past its expiry/i }),
    ).toBeInTheDocument();
  });

  it('shows the full pack CID as copyable evidence', () => {
    mocks.pack = { isLoading: false, isError: false, data: pack() };
    renderPage();
    expect(screen.getByText('bafyreiexamplecid')).toBeInTheDocument();
  });
});
