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
vi.mock('../src/packs/hooks.js', () => ({
  usePacks: () => ({
    isLoading: false,
    isError: false,
    data: { items: [], total: 0 },
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
});
