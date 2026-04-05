import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '../src/auth/AuthProvider.js';
import { useAuth } from '../src/auth/useAuth.js';

// Mock the kratos client
const mockToSession = vi.fn();
const mockCreateBrowserLogoutFlow = vi.fn();
const mockUpdateLogoutFlow = vi.fn();

vi.mock('../src/kratos.js', () => ({
  getKratosClient: () => ({
    toSession: mockToSession,
    createBrowserLogoutFlow: mockCreateBrowserLogoutFlow,
    updateLogoutFlow: mockUpdateLogoutFlow,
  }),
}));

function TestConsumer() {
  const { isAuthenticated, isLoading, username, email } = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="authenticated">{String(isAuthenticated)}</span>
      <span data-testid="username">{username ?? 'null'}</span>
      <span data-testid="email">{email ?? 'null'}</span>
    </div>
  );
}

describe('AuthProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state initially', () => {
    mockToSession.mockReturnValue(new Promise(() => {})); // Never resolves

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    expect(screen.getByTestId('loading').textContent).toBe('true');
  });

  it('sets authenticated state on successful session', async () => {
    mockToSession.mockResolvedValue({
      active: true,
      identity: {
        id: 'identity-123',
        traits: { username: 'testuser', email: 'test@example.com' },
      },
    });

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });

    expect(screen.getByTestId('authenticated').textContent).toBe('true');
    expect(screen.getByTestId('username').textContent).toBe('testuser');
    expect(screen.getByTestId('email').textContent).toBe('test@example.com');
  });

  it('sets unauthenticated state on failed session', async () => {
    mockToSession.mockRejectedValue(new Error('No session'));

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });

    expect(screen.getByTestId('authenticated').textContent).toBe('false');
    expect(screen.getByTestId('username').textContent).toBe('null');
  });
});
