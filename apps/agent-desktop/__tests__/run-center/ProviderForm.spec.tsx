import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MoltThemeProvider } from '@themoltnet/design-system';
import { describe, expect, it, vi } from 'vitest';

import { ProviderForm } from '../../src/run-center/ProviderForm.js';
import type {
  AgentServerProvider,
  ProviderActions,
} from '../../src/run-center/types.js';

const LOCAL: AgentServerProvider = {
  api: 'openai-completions',
  baseUrl: 'http://localhost:11434/v1',
  envName: 'MOLTNET_PROVIDER_OLLAMA_API_KEY',
  hasApiKey: false,
  models: [],
};
function setup(
  providers: Record<string, AgentServerProvider> = {},
  existingId?: string,
) {
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
        existingId={existingId}
        onChanged={onChanged}
        onDone={onDone}
      />
    </MoltThemeProvider>,
  );
  return { putProvider, discoverModels, onChanged, onDone };
}

describe('Desktop provider creation', () => {
  it('adds a keyless System One classifier to the local Ollama generation provider', async () => {
    const chat = { id: 'qwen3', type: 'chat' as const };
    const { putProvider, discoverModels, onDone } = setup(
      { ollama: { ...LOCAL, models: [chat] } },
      'ollama',
    );
    expect(
      screen.getByRole('option', { name: 'System One (Typesafe / Ollama)' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Local Ollama v0.35\+ supports System One/),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Classifier model ID'), {
      target: { value: 'nimble' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add classifier' }));
    expect(screen.getByRole('checkbox', { name: 'qwen3' })).toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: 'nimble (classifier)' }),
    ).toBeChecked();
    fireEvent.click(
      screen.getByRole('button', { name: /Save models for Ollama/ }),
    );
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(putProvider).toHaveBeenCalledWith('ollama', {
      api: 'openai-completions',
      baseUrl: 'http://localhost:11434/v1',
      envName: 'MOLTNET_PROVIDER_OLLAMA_API_KEY',
      supportsDeveloperRole: false,
      models: [
        chat,
        {
          id: 'nimble',
          type: 'classifier',
          api: 'typesafe-system-one',
          contextWindow: 8192,
        },
      ],
    });
    expect(putProvider.mock.calls[0][1]).not.toHaveProperty('apiKey');
    expect(discoverModels).not.toHaveBeenCalled();
  });

  it.each([
    'typesafe-system-one',
    'cloudflare-workers-ai-system-one',
    'llama-cpp-classify',
  ])(
    'configures a %s classifier without requiring model discovery',
    async (api) => {
      const { putProvider, discoverModels, onDone } = setup();
      fireEvent.change(screen.getByLabelText('Provider type'), {
        target: { value: 'custom' },
      });
      fireEvent.change(screen.getByLabelText('Provider ID'), {
        target: { value: 'decisions' },
      });
      fireEvent.change(screen.getByLabelText('Base URL'), {
        target: { value: 'https://classifier.example/v1' },
      });
      putProvider.mockResolvedValue({
        ...LOCAL,
        baseUrl: 'https://classifier.example/v1',
        envName: 'MOLTNET_PROVIDER_DECISIONS_API_KEY',
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save connection' }));
      await screen.findByLabelText('Classifier model ID');
      fireEvent.change(screen.getByLabelText('Classifier API'), {
        target: { value: api },
      });
      fireEvent.change(screen.getByLabelText('Classifier model ID'), {
        target: { value: ' decisions-v1 ' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Add classifier' }));
      fireEvent.click(
        screen.getByRole('button', { name: /Save models for decisions/ }),
      );
      await waitFor(() => expect(onDone).toHaveBeenCalled());
      expect(discoverModels).not.toHaveBeenCalled();
      expect(putProvider).toHaveBeenLastCalledWith(
        'decisions',
        expect.objectContaining({
          models: [
            {
              id: 'decisions-v1',
              type: 'classifier',
              api,
              contextWindow: 8192,
            },
          ],
        }),
      );
    },
  );

  it('adds a classifier beside a generation model and preserves both on refresh', async () => {
    const chat = {
      id: 'vision',
      input: ['text', 'image'] as Array<'text' | 'image'>,
      reasoning: true,
    };
    const { putProvider, discoverModels, onDone } = setup(
      { remote: { ...LOCAL, models: [chat] } },
      'remote',
    );
    fireEvent.change(screen.getByLabelText('Classifier model ID'), {
      target: { value: 'labels' },
    });
    fireEvent.change(screen.getByLabelText('Classifier context window'), {
      target: { value: '16384' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add classifier' }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh models' }));
    await waitFor(() => expect(discoverModels).toHaveBeenCalled());
    expect(
      screen.getByRole('checkbox', { name: 'labels (classifier)' }),
    ).toBeChecked();
    fireEvent.click(
      screen.getByRole('button', { name: /Save models for remote/ }),
    );
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(putProvider).toHaveBeenLastCalledWith(
      'remote',
      expect.objectContaining({
        models: [
          chat,
          {
            id: 'labels',
            type: 'classifier',
            api: 'typesafe-system-one',
            contextWindow: 16384,
          },
        ],
      }),
    );
  });

  it('rejects duplicate classifier IDs and invalid context windows', () => {
    setup(
      {
        remote: {
          ...LOCAL,
          models: [{ id: 'chat' }, { id: 'labels', type: 'classifier' }],
        },
      },
      'remote',
    );
    const add = screen.getByRole('button', { name: 'Add classifier' });
    expect(add).toBeDisabled();
    for (const id of ['chat', 'labels']) {
      fireEvent.change(screen.getByLabelText('Classifier model ID'), {
        target: { value: id },
      });
      expect(add).toBeDisabled();
      expect(
        screen.getByText(
          'This model ID is already configured. Choose a different ID.',
        ),
      ).toBeInTheDocument();
    }
    fireEvent.change(screen.getByLabelText('Classifier model ID'), {
      target: { value: 'new' },
    });
    for (const context of ['', '0', '-1', '1.5', '9007199254740992']) {
      fireEvent.change(screen.getByLabelText('Classifier context window'), {
        target: { value: context },
      });
      expect(add).toBeDisabled();
    }
    fireEvent.change(screen.getByLabelText('Classifier context window'), {
      target: { value: '8192' },
    });
    expect(add).toBeEnabled();
  });

  it('configures keyless Ollama and preserves discovered model capabilities', async () => {
    const { putProvider, discoverModels, onDone } = setup();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Save connection and discover models',
      }),
    );
    await screen.findByRole('checkbox', { name: 'vision' });
    expect(putProvider).toHaveBeenNthCalledWith(1, 'ollama', {
      api: 'openai-completions',
      baseUrl: LOCAL.baseUrl,
      envName: LOCAL.envName,
      models: [],
      supportsDeveloperRole: false,
    });
    expect(discoverModels).toHaveBeenCalledWith('ollama');
    fireEvent.click(
      screen.getByRole('button', { name: /Save models for Ollama/ }),
    );
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(putProvider).toHaveBeenLastCalledWith('ollama', {
      api: LOCAL.api,
      baseUrl: LOCAL.baseUrl,
      envName: LOCAL.envName,
      models: [{ id: 'vision', input: ['text', 'image'] }],
      supportsDeveloperRole: false,
    });
  });

  it('requires a cloud key and clears it before model discovery', async () => {
    const { putProvider, discoverModels } = setup();
    fireEvent.change(screen.getByLabelText('Provider type'), {
      target: { value: 'ollama-cloud' },
    });
    expect(
      screen.getByRole('button', {
        name: 'Save connection and discover models',
      }),
    ).toBeDisabled();
    fireEvent.change(screen.getByLabelText('API key'), {
      target: { value: 'secret-sentinel' },
    });
    putProvider.mockResolvedValue({
      ...LOCAL,
      baseUrl: 'https://ollama.com/v1',
      envName: 'MOLTNET_PROVIDER_OLLAMA_CLOUD_API_KEY',
      hasApiKey: true,
    });
    discoverModels.mockRejectedValue(
      new Error('Provider unavailable; try discovery again.'),
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Save connection and discover models',
      }),
    );
    await screen.findByText('Provider unavailable; try discovery again.');
    expect(
      screen.queryByDisplayValue('secret-sentinel'),
    ).not.toBeInTheDocument();
    expect(putProvider).toHaveBeenCalledWith(
      'ollama-cloud',
      expect.objectContaining({
        envName: 'MOLTNET_PROVIDER_OLLAMA_CLOUD_API_KEY',
        apiKey: 'secret-sentinel',
        baseUrl: 'https://ollama.com/v1',
      }),
    );
    expect(
      screen.getByRole('button', { name: 'Refresh models' }),
    ).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Close setup' })).toBeEnabled();
    expect(screen.getByText('API key saved on this Mac.')).toBeInTheDocument();
    expect(
      screen.getByText('Endpoint: https://ollama.com/v1'),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText('API key (optional)'),
    ).not.toBeInTheDocument();
  });

  it('saves a classifier connection key without discovery and clears it from the form', async () => {
    const { putProvider, discoverModels } = setup();
    fireEvent.change(screen.getByLabelText('Provider type'), {
      target: { value: 'custom' },
    });
    fireEvent.change(screen.getByLabelText('Provider ID'), {
      target: { value: 'classifier' },
    });
    fireEvent.change(screen.getByLabelText('Base URL'), {
      target: { value: 'https://classifier.example/v1' },
    });
    fireEvent.change(screen.getByLabelText('API key (optional)'), {
      target: { value: 'secret-sentinel' },
    });
    putProvider.mockResolvedValue({ ...LOCAL, hasApiKey: true });
    fireEvent.click(screen.getByRole('button', { name: 'Save connection' }));
    await screen.findByLabelText('Classifier model ID');
    expect(
      screen.queryByDisplayValue('secret-sentinel'),
    ).not.toBeInTheDocument();
    expect(putProvider).toHaveBeenCalledWith(
      'classifier',
      expect.objectContaining({ apiKey: 'secret-sentinel' }),
    );
    expect(discoverModels).not.toHaveBeenCalled();
  });

  it('preserves saved classifiers when discovery fails and allows saving selections', async () => {
    const classifier = {
      id: 'labels',
      type: 'classifier' as const,
      api: 'typesafe-system-one',
      contextWindow: 8192,
    };
    const { discoverModels, putProvider, onDone } = setup(
      { remote: { ...LOCAL, models: [classifier] } },
      'remote',
    );
    discoverModels.mockRejectedValue(new Error('No discovery endpoint'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh models' }));
    await screen.findByText('No discovery endpoint');
    expect(
      screen.getByRole('checkbox', { name: 'labels (classifier)' }),
    ).toBeChecked();
    fireEvent.click(
      screen.getByRole('button', { name: /Save models for remote/ }),
    );
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(putProvider).toHaveBeenCalledWith(
      'remote',
      expect.objectContaining({ models: [classifier] }),
    );
  });

  it('selects all matching models, preserves other selections and refreshes without rewriting the connection', async () => {
    const { discoverModels, putProvider } = setup();
    discoverModels.mockResolvedValue([
      { id: 'alpha' },
      { id: 'beta' },
      { id: 'alpine' },
    ]);
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Save connection and discover models',
      }),
    );
    await screen.findByRole('checkbox', { name: 'alpha' });
    fireEvent.click(screen.getByRole('button', { name: 'Select all (3)' }));
    fireEvent.change(screen.getByLabelText('Filter models'), {
      target: { value: 'al' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Clear matching selection' }),
    );
    expect(
      screen.getByRole('button', {
        name: 'Save models for Ollama (local) (1)',
      }),
    ).toBeEnabled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Select all matching (2)' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Refresh models' }));
    await waitFor(() => expect(discoverModels).toHaveBeenCalledTimes(2));
    expect(putProvider).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('button', {
        name: 'Save models for Ollama (local) (3)',
      }),
    ).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Filter models'), {
      target: { value: '' },
    });
    expect(screen.getByRole('checkbox', { name: 'beta' })).toBeChecked();
  });

  it('does not carry a cloud key into another provider preset', () => {
    setup();
    fireEvent.change(screen.getByLabelText('Provider type'), {
      target: { value: 'ollama-cloud' },
    });
    fireEvent.change(screen.getByLabelText('API key'), {
      target: { value: 'secret-sentinel' },
    });
    fireEvent.change(screen.getByLabelText('Provider type'), {
      target: { value: 'custom' },
    });
    expect(screen.getByLabelText('API key (optional)')).toHaveValue('');
  });

  it('lets a custom endpoint use the developer role even on Ollama port', async () => {
    const { putProvider } = setup();
    fireEvent.change(screen.getByLabelText('Provider type'), {
      target: { value: 'custom' },
    });
    fireEvent.change(screen.getByLabelText('Provider ID'), {
      target: { value: 'proxy' },
    });
    fireEvent.change(screen.getByLabelText('Base URL'), {
      target: { value: 'http://localhost:11434/v1' },
    });
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Save connection and discover models',
      }),
    );
    await waitFor(() => expect(putProvider).toHaveBeenCalled());
    expect(putProvider).toHaveBeenCalledWith(
      'proxy',
      expect.objectContaining({ supportsDeveloperRole: true }),
    );
  });

  it('defaults a legacy Ollama provider to the system role when saved', async () => {
    const { putProvider } = setup({ ollama: LOCAL }, 'ollama');
    expect(screen.getByLabelText('Instruction message role')).toHaveValue(
      'system',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Refresh models' }));
    await screen.findByRole('checkbox', { name: 'vision' });
    fireEvent.click(
      screen.getByRole('button', { name: /Save models for Ollama/ }),
    );
    await waitFor(() => expect(putProvider).toHaveBeenCalled());
    expect(putProvider).toHaveBeenCalledWith(
      'ollama',
      expect.objectContaining({ supportsDeveloperRole: false }),
    );
  });

  it('preserves an explicit developer role on an existing Ollama provider', () => {
    setup({ ollama: { ...LOCAL, supportsDeveloperRole: true } }, 'ollama');
    expect(screen.getByLabelText('Instruction message role')).toHaveValue(
      'developer',
    );
  });

  it('prevents the add form from overwriting an existing provider', () => {
    const { putProvider } = setup({ ollama: LOCAL });
    expect(
      screen.getByRole('button', {
        name: 'Save connection and discover models',
      }),
    ).toBeDisabled();
    expect(putProvider).not.toHaveBeenCalled();
  });
});
