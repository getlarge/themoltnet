import { render, screen, waitFor } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthGuard } from '../src/auth/AuthGuard.js';
import { AuthProvider } from '../src/auth/AuthProvider.js';

const mockToSession = vi.fn();

vi.mock('../src/kratos.js', () => ({
  getKratosClient: () => ({
    toSession: mockToSession,
    createBrowserLogoutFlow: vi.fn(),
    updateLogoutFlow: vi.fn(),
  }),
}));

// Mock wouter's Redirect
vi.mock('wouter', () => ({
  Redirect: ({ to }: { to: string }) => <div data-testid="redirect">{to}</div>,
}));

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <MoltThemeProvider mode="dark">
      <AuthProvider>{children}</AuthProvider>
    </MoltThemeProvider>
  );
}

describe('AuthGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state while checking session', () => {
    mockToSession.mockReturnValue(new Promise(() => {}));

    render(
      <AuthGuard>
        <div data-testid="protected">Protected content</div>
      </AuthGuard>,
      { wrapper: Wrapper },
    );

    expect(screen.queryByTestId('protected')).toBeNull();
    expect(screen.getByText('Loading...')).toBeDefined();
  });

  it('redirects to login when not authenticated', async () => {
    mockToSession.mockRejectedValue(new Error('No session'));

    render(
      <AuthGuard>
        <div data-testid="protected">Protected content</div>
      </AuthGuard>,
      { wrapper: Wrapper },
    );

    await waitFor(() => {
      expect(screen.getByTestId('redirect')).toBeDefined();
    });

    expect(screen.getByTestId('redirect').textContent).toBe('/auth/login');
    expect(screen.queryByTestId('protected')).toBeNull();
  });

  it('renders children when authenticated', async () => {
    mockToSession.mockResolvedValue({
      active: true,
      identity: {
        id: 'identity-123',
        traits: { username: 'testuser', email: 'test@example.com' },
      },
    });

    render(
      <AuthGuard>
        <div data-testid="protected">Protected content</div>
      </AuthGuard>,
      { wrapper: Wrapper },
    );

    await waitFor(() => {
      expect(screen.getByTestId('protected')).toBeDefined();
    });

    expect(screen.getByTestId('protected').textContent).toBe(
      'Protected content',
    );
  });
});
