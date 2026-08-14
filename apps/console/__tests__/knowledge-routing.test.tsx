/**
 * Routing-level cover for the Knowledge Factory hub.
 *
 * knowledge-navigation.test.tsx renders only the Sidebar, so deleting the
 * `/knowledge` <Route> from App would leave it green while the advertised link
 * silently fell through to NotFoundPage. This test drives App itself.
 *
 * AuthGuard and DashboardLayout are stubbed to passthroughs: this asserts the
 * route table, not the session or the chrome.
 */
import { render, screen } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';

vi.mock('../src/auth/AuthGuard.js', () => ({
  AuthGuard: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('../src/layout/DashboardLayout.js', () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => children,
}));

// The route table is under test, not data fetching: stub the pack queries so
// PacksPage renders without a QueryClient in the tree.
vi.mock('../src/team/useTeam.js', () => ({
  useTeam: () => ({ selectedTeam: { id: 'team-1' } }),
}));

vi.mock('../src/packs/hooks.js', () => ({
  usePacks: () => ({
    isLoading: false,
    isError: false,
    data: { items: [], total: 0 },
  }),
  usePack: () => ({
    isLoading: false,
    isError: false,
    data: {
      id: '11111111-2222-3333-4444-555555555555',
      diaryId: 'diary-1',
      createdAt: new Date().toISOString(),
      expiresAt: null,
      pinned: true,
      packCid: 'bafyreiexamplecid',
      packCodec: 'dag-cbor',
      packType: 'optimized',
      params: { prompt: 'How does auth work?' },
      payload: {},
      creator: {
        kind: 'agent',
        fingerprint: '1671-B080-99BF-4270',
        identityId: 'id-1',
        publicKey: 'ed25519:x',
      },
      supersedesPackId: null,
    },
  }),
  usePinPack: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
}));

import { App } from '../src/App.js';

function renderAt(path: string) {
  const { hook } = memoryLocation({ path, static: true });
  return render(
    <MoltThemeProvider>
      <Router hook={hook}>
        <App />
      </Router>
    </MoltThemeProvider>,
  );
}

describe('/knowledge route', () => {
  it('renders the Knowledge Factory hub', () => {
    renderAt('/knowledge');

    expect(
      screen.getByRole('heading', { name: /knowledge factory/i }),
    ).toBeInTheDocument();
  });

  it('does not fall through to the not-found page', () => {
    renderAt('/knowledge');

    expect(screen.queryByText(/not found/i)).not.toBeInTheDocument();
  });

  it('renders the pack catalog at /packs', () => {
    renderAt('/packs');

    expect(
      screen.getByRole('heading', { name: /^packs$/i }),
    ).toBeInTheDocument();
  });

  /**
   * PackCard advertises /packs/:id via its optional `onOpen`. This is the guard
   * that the destination exists: the catalog must never link somewhere that
   * falls through to NotFoundPage (the defect this route closes from #1883).
   */
  it('resolves /packs/:id to the pack detail page', () => {
    renderAt('/packs/11111111-2222-3333-4444-555555555555');

    expect(
      screen.getByRole('heading', { name: /How does auth work\?/ }),
    ).toBeInTheDocument();
  });

  it('does not fall through to the not-found page for a pack detail route', () => {
    renderAt('/packs/11111111-2222-3333-4444-555555555555');

    expect(screen.queryByText(/not found/i)).not.toBeInTheDocument();
  });
});
