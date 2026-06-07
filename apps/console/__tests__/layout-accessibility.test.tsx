import { fireEvent, render, screen } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Header } from '../src/layout/Header.js';
import { Sidebar } from '../src/layout/Sidebar.js';

const navigate = vi.fn();

vi.mock('wouter', () => ({
  useLocation: () => ['/tasks', navigate],
}));

vi.mock('../src/auth/useAuth.js', () => ({
  useAuth: () => ({
    email: 'agent@example.com',
    logout: vi.fn(),
    username: 'agent',
  }),
}));

vi.mock('../src/components/TeamSelector.js', () => ({
  TeamSelector: () => <div data-testid="team-selector" />,
}));

vi.mock('../src/config.js', () => ({
  getConfig: () => ({
    docsUrl: 'https://docs.example.com',
    kratosUrl: 'https://auth.example.com',
  }),
}));

function Wrapper({ children }: { children: ReactNode }) {
  return <MoltThemeProvider mode="dark">{children}</MoltThemeProvider>;
}

describe('console layout accessibility', () => {
  it('exposes the sidebar toggle relationship and expanded state', () => {
    const onMenuClick = vi.fn();

    render(
      <Header
        menuControls="console-sidebar"
        menuExpanded={false}
        onMenuClick={onMenuClick}
        showMenuButton
      />,
      { wrapper: Wrapper },
    );

    const toggle = screen.getByRole('button', { name: 'Toggle sidebar' });

    expect(toggle.getAttribute('aria-controls')).toBe('console-sidebar');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(toggle);
    expect(onMenuClick).toHaveBeenCalledTimes(1);
  });

  it('labels primary navigation and marks the active route', () => {
    render(<Sidebar id="console-sidebar" />, { wrapper: Wrapper });

    expect(
      screen.getByRole('complementary', { name: 'Workspace navigation' }),
    ).toBeDefined();
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeDefined();

    const tasks = screen.getByRole('button', { name: 'Tasks' });
    expect(tasks.getAttribute('aria-current')).toBe('page');
  });

  it('keeps collapsed navigation buttons named beyond their initials', () => {
    render(<Sidebar collapsed id="console-sidebar" />, { wrapper: Wrapper });

    expect(screen.getByRole('button', { name: 'Tasks' }).textContent).toBe('T');
    expect(
      screen.getByRole('button', { name: 'Documentation' }).textContent,
    ).toBe('D');
    expect(screen.getByRole('button', { name: 'Settings' }).textContent).toBe(
      'S',
    );
  });
});
