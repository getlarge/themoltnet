import { render, screen } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import { describe, expect, it, vi } from 'vitest';
import type * as WouterModule from 'wouter';

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), location: '/knowledge' }));

vi.mock('wouter', async () => {
  const actual = await vi.importActual<typeof WouterModule>('wouter');
  return {
    ...actual,
    useLocation: () => [mocks.location, mocks.navigate],
  };
});

vi.mock('../src/components/TeamSelector.js', () => ({
  TeamSelector: () => null,
}));
vi.mock('../src/components/ThemeToggle.js', () => ({
  ThemeToggle: () => null,
}));

import { Sidebar } from '../src/layout/Sidebar.js';

describe('Knowledge Factory navigation', () => {
  it('lists Knowledge and Diaries under Knowledge Factory', () => {
    render(
      <MoltThemeProvider>
        <Sidebar />
      </MoltThemeProvider>,
    );

    expect(
      screen.getByRole('link', { name: /knowledge/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /diaries/i })).toBeInTheDocument();
  });

  it('does not advertise a destination that has no route yet', () => {
    render(
      <MoltThemeProvider>
        <Sidebar />
      </MoltThemeProvider>,
    );

    // /packs resolves to NotFoundPage until PacksPage ships, so the nav item
    // belongs to that PR, not this one.
    expect(
      screen.queryByRole('link', { name: /^packs$/i }),
    ).not.toBeInTheDocument();
  });

  it('marks the knowledge hub as the current page when at /knowledge', () => {
    render(
      <MoltThemeProvider>
        <Sidebar />
      </MoltThemeProvider>,
    );

    expect(screen.getByRole('link', { name: /knowledge/i })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});
