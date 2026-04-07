import { render, screen, waitFor } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthGuard } from '../src/auth/AuthGuard.js';
import { AuthProvider } from '../src/auth/AuthProvider.js';

const mockToSession = vi.fn();
const mockAssign = vi.fn();

vi.mock('../src/kratos.js', () => ({
  getKratosClient: () => ({
    toSession: mockToSession,
    createBrowserLogoutFlow: vi.fn(),
  }),
}));

vi.mock('../src/config.js', () => ({
  getConfig: () => ({
    kratosUrl: 'https://auth.example.com',
    consoleUrl: 'https://console.example.com',
    apiBaseUrl: 'https://api.example.com',
  }),
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
    Object.defineProperty(window, 'location', {
      value: { assign: mockAssign },
      writable: true,
    });
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

  it('redirects to Ory login when not authenticated', async () => {
    mockToSession.mockRejectedValue(new Error('No session'));

    render(
      <AuthGuard>
        <div data-testid="protected">Protected content</div>
      </AuthGuard>,
      { wrapper: Wrapper },
    );

    await waitFor(() => {
      expect(mockAssign).toHaveBeenCalled();
    });

    expect(mockAssign.mock.calls[0][0]).toContain(
      'https://auth.example.com/self-service/login/browser',
    );
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
