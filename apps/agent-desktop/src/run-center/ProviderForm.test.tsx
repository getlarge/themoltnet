import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import { describe, expect, it, vi } from 'vitest';

import { ProviderForm } from './ProviderForm.js';
import type { AgentServerProvider, ProviderActions } from './types.js';

const LOCAL: AgentServerProvider = {
  api: 'openai-completions',
  baseUrl: 'http://localhost:11434/v1',
  envName: 'OLLAMA_LOCAL_API_KEY',
  hasApiKey: false,
  models: [],
};
function setup(providers: Record<string, AgentServerProvider> = {}) {
  const putProvider = vi.fn().mockResolvedValue(LOCAL);
  const discoverModels = vi
    .fn()
    .mockResolvedValue([{ id: 'vision', input: ['text', 'image'] }]);
  const actions: ProviderActions = {
    putProvider,
    discoverModels,
    deleteProvider: vi.fn(),
  };
  const onChanged = vi.fn();
  const onDone = vi.fn();
  render(
    <MoltThemeProvider mode="dark">
      <ProviderForm
        providers={providers}
        actions={actions}
        onChanged={onChanged}
        onDone={onDone}
      />
    </MoltThemeProvider>,
  );
  return { putProvider, discoverModels, onChanged, onDone };
}

describe('Desktop provider creation', () => {
  it('configures keyless Ollama and preserves discovered model capabilities', async () => {
    const { putProvider, discoverModels, onDone } = setup();
    fireEvent.click(
      screen.getByRole('button', { name: 'Save and discover models' }),
    );
    await screen.findByRole('checkbox', { name: 'vision' });
    expect(putProvider).toHaveBeenNthCalledWith(1, 'ollama-local', {
      api: 'openai-completions',
      baseUrl: LOCAL.baseUrl,
      envName: LOCAL.envName,
      models: [],
    });
    expect(discoverModels).toHaveBeenCalledWith('ollama-local');
    fireEvent.click(
      screen.getByRole('button', { name: /Save selected models/ }),
    );
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(putProvider).toHaveBeenLastCalledWith('ollama-local', {
      api: LOCAL.api,
      baseUrl: LOCAL.baseUrl,
      envName: LOCAL.envName,
      models: [{ id: 'vision', input: ['text', 'image'] }],
    });
  });

  it('requires a cloud key and clears it before model discovery', async () => {
    const { putProvider, discoverModels } = setup();
    fireEvent.change(screen.getByLabelText('Provider type'), {
      target: { value: 'ollama' },
    });
    expect(
      screen.getByRole('button', { name: 'Save and discover models' }),
    ).toBeDisabled();
    fireEvent.change(screen.getByLabelText('API key'), {
      target: { value: 'secret-sentinel' },
    });
    putProvider.mockResolvedValue({
      ...LOCAL,
      baseUrl: 'https://ollama.com/v1',
      hasApiKey: true,
    });
    discoverModels.mockRejectedValue(
      new Error('Provider unavailable; try discovery again.'),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Save and discover models' }),
    );
    await screen.findByText('Provider unavailable; try discovery again.');
    expect(
      screen.queryByDisplayValue('secret-sentinel'),
    ).not.toBeInTheDocument();
    expect(putProvider).toHaveBeenCalledWith(
      'ollama',
      expect.objectContaining({
        apiKey: 'secret-sentinel',
        baseUrl: 'https://ollama.com/v1',
      }),
    );
    expect(
      screen.getByRole('button', { name: 'Discover models' }),
    ).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Done' })).toBeEnabled();
  });

  it('does not carry a cloud key into another provider preset', () => {
    setup();
    fireEvent.change(screen.getByLabelText('Provider type'), {
      target: { value: 'ollama' },
    });
    fireEvent.change(screen.getByLabelText('API key'), {
      target: { value: 'secret-sentinel' },
    });
    fireEvent.change(screen.getByLabelText('Provider type'), {
      target: { value: 'custom' },
    });
    expect(screen.getByLabelText('API key (optional)')).toHaveValue('');
  });

  it('prevents the add form from overwriting an existing provider', () => {
    const { putProvider } = setup({ 'ollama-local': LOCAL });
    expect(
      screen.getByRole('button', { name: 'Save and discover models' }),
    ).toBeDisabled();
    expect(putProvider).not.toHaveBeenCalled();
  });
});
