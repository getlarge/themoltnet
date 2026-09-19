import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import { describe, expect, it, vi } from 'vitest';

import { ProvidersView } from './ProvidersView.js';
import type {
  AgentServerProvider,
  AgentServerSubscription,
  ProviderActions,
  SubscriptionActions,
} from './types.js';

const ANTHROPIC: AgentServerProvider = {
  api: 'anthropic',
  baseUrl: 'https://api.anthropic.com',
  envName: 'ANTHROPIC_API_KEY',
  hasApiKey: true,
  models: [{ id: 'claude-opus-5' }],
};

const OPENAI: AgentServerProvider = {
  api: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  envName: 'OPENAI_API_KEY',
  hasApiKey: false,
  models: [{ id: 'gpt-5.2' }],
};

/** Holds the mocks directly so assertions never reference an unbound method. */
function renderView(
  providers: Record<string, AgentServerProvider>,
  overrides: Partial<ProviderActions> = {},
) {
  const putProvider = vi.fn().mockResolvedValue(ANTHROPIC);
  const deleteProvider = vi.fn().mockResolvedValue(undefined);
  const actions: ProviderActions = {
    putProvider,
    deleteProvider,
    discoverModels: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
  render(
    <MoltThemeProvider mode="dark">
      <ProvidersView
        providers={providers}
        actions={actions}
        onChanged={vi.fn()}
      />
    </MoltThemeProvider>,
  );
  return { putProvider, deleteProvider };
}

describe('ProvidersView', () => {
  it('shows which providers hold a key on this machine', () => {
    // Arrange / Act
    renderView({ anthropic: ANTHROPIC, openai: OPENAI });

    // Assert
    expect(screen.getByText('anthropic')).toBeInTheDocument();
    expect(screen.getByText('ANTHROPIC_API_KEY')).toBeInTheDocument();
    expect(screen.getByText(/key configured/iu)).toBeInTheDocument();
    expect(screen.getByText(/no key/iu)).toBeInTheDocument();
  });

  it('never renders a key value, because the server does not return one', () => {
    // Arrange / Act
    renderView({ anthropic: ANTHROPIC });

    // Assert: the contract carries `hasApiKey` only; nothing can display a
    // secret it was never given.
    expect(screen.queryByDisplayValue(/sk-/iu)).not.toBeInTheDocument();
    expect(Object.keys(ANTHROPIC)).not.toContain('apiKey');
  });

  it('sends a typed key through to the server', async () => {
    // Arrange
    const mocks = renderView({ openai: OPENAI });
    fireEvent.click(
      screen.getByRole('button', { name: /add key for openai/iu }),
    );

    // Act
    fireEvent.change(screen.getByLabelText(/api key/iu), {
      target: { value: 'test-key-value' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^save key$/iu }));

    // Assert
    await waitFor(() => {
      expect(mocks.putProvider).toHaveBeenCalledWith(
        'openai',
        expect.objectContaining({
          api: 'openai',
          envName: 'OPENAI_API_KEY',
          apiKey: 'test-key-value',
        }),
      );
    });
  });

  it('does not submit an empty key', async () => {
    // Arrange
    const mocks = renderView({ openai: OPENAI });
    fireEvent.click(
      screen.getByRole('button', { name: /add key for openai/iu }),
    );

    // Act
    fireEvent.click(screen.getByRole('button', { name: /^save key$/iu }));

    // Assert
    await waitFor(() => {
      expect(mocks.putProvider).not.toHaveBeenCalled();
    });
  });

  it('clears the typed key from state once it is saved', async () => {
    // A key left in component state outlives its usefulness and is one more
    // place it can leak from.
    renderView({ openai: OPENAI });
    fireEvent.click(
      screen.getByRole('button', { name: /add key for openai/iu }),
    );
    fireEvent.change(screen.getByLabelText(/api key/iu), {
      target: { value: 'test-key-value' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^save key$/iu }));

    await waitFor(() => {
      expect(
        screen.queryByDisplayValue('test-key-value'),
      ).not.toBeInTheDocument();
    });
  });

  it('surfaces the server message when saving fails', async () => {
    // Arrange
    const putProvider = vi
      .fn()
      .mockRejectedValue(new Error('the Agent Server is not running'));
    renderView({ openai: OPENAI }, { putProvider });
    fireEvent.click(
      screen.getByRole('button', { name: /add key for openai/iu }),
    );
    fireEvent.change(screen.getByLabelText(/api key/iu), {
      target: { value: 'test-key-value' },
    });

    // Act
    fireEvent.click(screen.getByRole('button', { name: /^save key$/iu }));

    // Assert
    await waitFor(() => {
      expect(
        screen.getByText(/the Agent Server is not running/iu),
      ).toBeInTheDocument();
    });
    expect(putProvider).toHaveBeenCalled();
  });

  it('asks before removing a provider', async () => {
    // Arrange
    const mocks = renderView({ anthropic: ANTHROPIC });

    // Act
    fireEvent.click(screen.getByRole('button', { name: /remove anthropic/iu }));

    // Assert: a destructive action is confirmed, not performed on one click.
    expect(mocks.deleteProvider).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('explains the empty case rather than showing a bare list', () => {
    // Arrange / Act
    renderView({});

    // Assert
    expect(screen.getByText(/no providers configured/iu)).toBeInTheDocument();
  });
});

const CLAUDE: AgentServerSubscription = {
  id: 'anthropic',
  name: 'Claude',
  connected: false,
};

function renderWithSubscriptions(
  subscriptions: AgentServerSubscription[],
  overrides: Partial<SubscriptionActions> = {},
) {
  const startLogin = vi.fn().mockResolvedValue({
    providerId: 'anthropic',
    status: 'pending',
    userCode: 'WDJB-MJHT',
    verificationUri: 'https://console.anthropic.com/device',
  });
  const loginStatus = vi.fn().mockResolvedValue({
    providerId: 'anthropic',
    status: 'completed',
  });
  const cancelLogin = vi.fn().mockResolvedValue(undefined);
  const openSignIn = vi.fn().mockResolvedValue(undefined);
  const actions: SubscriptionActions = {
    startLogin,
    loginStatus,
    cancelLogin,
    openSignIn,
    ...overrides,
  };
  render(
    <MoltThemeProvider mode="dark">
      <ProvidersView
        providers={{}}
        actions={{
          putProvider: vi.fn(),
          deleteProvider: vi.fn(),
          discoverModels: vi.fn(),
        }}
        subscriptions={subscriptions}
        subscriptionActions={actions}
        onChanged={vi.fn()}
      />
    </MoltThemeProvider>,
  );
  return { startLogin, loginStatus, cancelLogin, openSignIn };
}

describe('subscription sign-in', () => {
  it('offers a subscription as an alternative to an API key', () => {
    // Arrange / Act
    renderWithSubscriptions([CLAUDE]);

    // Assert
    expect(screen.getByText('Claude')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /sign in to claude/iu }),
    ).toBeInTheDocument();
  });

  it('shows the device code the operator must type', async () => {
    // Arrange
    const mocks = renderWithSubscriptions([CLAUDE]);

    // Act
    fireEvent.click(
      screen.getByRole('button', { name: /sign in to claude/iu }),
    );

    // Assert
    await waitFor(() => {
      expect(screen.getByText('WDJB-MJHT')).toBeInTheDocument();
    });
    expect(mocks.startLogin).toHaveBeenCalledWith('anthropic');
  });

  it('opens the sign-in page natively rather than from the WebView', async () => {
    // A browser cannot open a window after an await; native code can, so the
    // operator does not have to copy a URL by hand.
    const mocks = renderWithSubscriptions([CLAUDE]);

    fireEvent.click(
      screen.getByRole('button', { name: /sign in to claude/iu }),
    );

    await waitFor(() => {
      expect(mocks.openSignIn).toHaveBeenCalledWith(
        'https://console.anthropic.com/device',
      );
    });
  });

  it('reports a failed sign-in with the provider reason', async () => {
    // Arrange
    renderWithSubscriptions([CLAUDE], {
      startLogin: vi.fn().mockResolvedValue({
        providerId: 'anthropic',
        status: 'failed',
        error: 'the device code expired',
      }),
    });

    // Act
    fireEvent.click(
      screen.getByRole('button', { name: /sign in to claude/iu }),
    );

    // Assert
    await waitFor(() => {
      expect(screen.getByText(/the device code expired/iu)).toBeInTheDocument();
    });
  });

  it('lets the operator abandon a pending sign-in', async () => {
    // Arrange
    const mocks = renderWithSubscriptions([CLAUDE], {
      loginStatus: vi
        .fn()
        .mockResolvedValue({ providerId: 'anthropic', status: 'pending' }),
    });
    fireEvent.click(
      screen.getByRole('button', { name: /sign in to claude/iu }),
    );
    await waitFor(() => {
      expect(screen.getByText('WDJB-MJHT')).toBeInTheDocument();
    });

    // Act
    fireEvent.click(screen.getByRole('button', { name: /cancel sign-in/iu }));

    // Assert
    await waitFor(() => {
      expect(mocks.cancelLogin).toHaveBeenCalledWith('anthropic');
    });
  });

  it('shows a connected subscription as needing no key', () => {
    // Arrange / Act
    renderWithSubscriptions([{ ...CLAUDE, connected: true }]);

    // Assert
    expect(screen.getByText(/signed in/iu)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /sign in to claude/iu }),
    ).not.toBeInTheDocument();
  });
});
