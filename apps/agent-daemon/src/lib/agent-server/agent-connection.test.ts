/**
 * The production credential path the catalogue route uses.
 *
 * Every catalogue test injects `catalogueAgentFor`, so without this file the
 * real connector never runs and a credential mistake — wrong provider registry,
 * wrong API URL, missing key — surfaces only in production. A seam introduced
 * for testability must not be the seam a credential bug hides behind.
 */
import {
  READ_ONLY_CAPABILITIES,
  SecretProviderRegistry,
} from '@themoltnet/sdk';
import { describe, expect, it, vi } from 'vitest';

import { connectActivatedAgent, type ConnectImpl } from './agent-connection.js';
import type { ActivatedAgent } from './identity.js';

/** A registry that holds exactly the keys it is given. */
function registry(values: Record<string, string>): SecretProviderRegistry {
  return new SecretProviderRegistry().register({
    name: 'memory',
    capabilities: READ_ONLY_CAPABILITIES,
    read: (key) => Promise.resolve(values[key] ?? null),
    probe: (key) =>
      Promise.resolve(
        key in values ? ('present' as const) : ('absent' as const),
      ),
  });
}

function activated(overrides: {
  source: 'managed' | 'external';
  apiUrl?: string;
  configApiUrl?: string;
  keyRef?: string;
}): ActivatedAgent {
  return {
    activation: {
      source: overrides.source,
      alias: 'course-bot',
      subjectId: 'agent-1',
      publicKey: 'pk',
      fingerprint: 'FP-1',
      createdAt: 't',
      ...(overrides.apiUrl ? { apiUrl: overrides.apiUrl } : {}),
      ...(overrides.configApiUrl
        ? { configApiUrl: overrides.configApiUrl }
        : {}),
    },
    config: {
      subject_id: 'agent-1',
      subject_type: 'agent',
      registered_at: 't',
      agent_key_ref: {
        provider: 'memory',
        key: overrides.keyRef ?? 'agent-key/agent-1',
      },
      keys: {
        public_key: 'pk',
        fingerprint: 'FP-1',
        private_key_ref: { provider: 'memory', key: 'identity/FP-1/seed' },
      },
      endpoints: { api: 'https://api.example', mcp: 'https://mcp.example/mcp' },
    },
  } as unknown as ActivatedAgent;
}

/** Records what the SDK would have been asked to connect with. */
function recordingConnect() {
  const calls: { agentKey?: string; apiUrl?: string }[] = [];
  const impl = vi.fn((options: { agentKey?: string; apiUrl?: string }) => {
    calls.push(options);
    return Promise.resolve({} as Awaited<ReturnType<ConnectImpl>>);
  }) as unknown as ConnectImpl;
  return { impl, calls };
}

const failIfCalled = () =>
  new Error('onMissingKey should not have been called');

describe('connectActivatedAgent', () => {
  it('uses the managed registry for a managed identity', async () => {
    // Arrange
    const { impl, calls } = recordingConnect();

    // Act
    await connectActivatedAgent({
      activated: activated({
        source: 'managed',
        apiUrl: 'https://api.example',
      }),
      secretProviders: registry({ 'agent-key/agent-1': 'managed-key' }),
      externalSecretProviders: registry({}),
      onMissingKey: failIfCalled,
      connectImpl: impl,
    });

    // Assert
    expect(calls[0]?.agentKey).toBe('managed-key');
  });

  it('uses the external registry for an external identity', async () => {
    // A managed agent's key must never be reachable through the external
    // registry, or an attached identity could borrow the wrong credential.
    const { impl, calls } = recordingConnect();

    await connectActivatedAgent({
      activated: activated({
        source: 'external',
        apiUrl: 'https://api.example',
      }),
      secretProviders: registry({ 'agent-key/agent-1': 'managed-key' }),
      externalSecretProviders: registry({
        'agent-key/agent-1': 'external-key',
      }),
      onMissingKey: failIfCalled,
      connectImpl: impl,
    });

    expect(calls[0]?.agentKey).toBe('external-key');
  });

  it.each(['managed', 'external'] as const)(
    'selects the requested team key for a %s identity',
    async (source) => {
      const agent = activated({ source });
      agent.activation.boundTeamId = 'team-a';
      agent.config.agent_key_refs = {
        'team-a': { provider: 'memory', key: 'agent-key/agent-1/team-a' },
        'team-b': { provider: 'memory', key: 'agent-key/agent-1/team-b' },
      };
      const providers = registry({
        'agent-key/agent-1': 'fallback',
        'agent-key/agent-1/team-a': 'key-a',
        'agent-key/agent-1/team-b': 'key-b',
      });
      const { impl, calls } = recordingConnect();

      await connectActivatedAgent({
        activated: agent,
        teamId: 'team-b',
        secretProviders: source === 'managed' ? providers : registry({}),
        externalSecretProviders:
          source === 'external' ? providers : registry({}),
        onMissingKey: failIfCalled,
        connectImpl: impl,
      });

      expect(calls[0]?.agentKey).toBe('key-b');
    },
  );

  it('does not fall back when the selected team key cannot be read', async () => {
    const agent = activated({ source: 'managed' });
    agent.config.agent_key_refs = {
      'team-b': { provider: 'memory', key: 'agent-key/agent-1/team-b' },
    };
    const { impl } = recordingConnect();
    const providers = registry({ 'agent-key/agent-1': 'fallback' });

    await expect(
      connectActivatedAgent({
        activated: agent,
        teamId: 'team-b',
        secretProviders: providers,
        externalSecretProviders: registry({}),
        onMissingKey: (message) => new Error(message),
        connectImpl: impl,
      }),
    ).rejects.toThrow('has no usable agent key');
    expect(impl).not.toHaveBeenCalled();
  });

  it('raises the caller error when a managed identity has no key', async () => {
    // Arrange
    const { impl } = recordingConnect();
    const onMissingKey = vi.fn(
      (message: string) => new Error(`mapped: ${message}`),
    );

    // Act / Assert
    await expect(
      connectActivatedAgent({
        activated: activated({ source: 'managed' }),
        secretProviders: registry({}),
        externalSecretProviders: registry({}),
        onMissingKey,
        connectImpl: impl,
      }),
    ).rejects.toThrow(
      /mapped: managed agent "course-bot" has no usable agent key/u,
    );
  });

  it('names the external case in its error, not the managed one', async () => {
    // Arrange
    const { impl } = recordingConnect();

    // Act / Assert
    await expect(
      connectActivatedAgent({
        activated: activated({ source: 'external' }),
        secretProviders: registry({ 'agent-key/agent-1': 'managed-key' }),
        externalSecretProviders: registry({}),
        onMissingKey: (message) => new Error(message),
        connectImpl: impl,
      }),
    ).rejects.toThrow(/external agent "course-bot" has no usable agent key/u);
  });

  it('prefers the activation API URL over the configured one', async () => {
    // Arrange
    const { impl, calls } = recordingConnect();

    // Act
    await connectActivatedAgent({
      activated: activated({
        source: 'external',
        apiUrl: 'https://activation.example',
        configApiUrl: 'https://config.example',
      }),
      secretProviders: registry({}),
      externalSecretProviders: registry({
        'agent-key/agent-1': 'external-key',
      }),
      onMissingKey: failIfCalled,
      connectImpl: impl,
    });

    // Assert
    expect(calls[0]?.apiUrl).toBe('https://activation.example');
  });

  it('falls back to the configured API URL when the activation has none', async () => {
    // An attached identity registered elsewhere carries its own endpoint.
    const { impl, calls } = recordingConnect();

    await connectActivatedAgent({
      activated: activated({
        source: 'external',
        configApiUrl: 'https://config.example',
      }),
      secretProviders: registry({}),
      externalSecretProviders: registry({
        'agent-key/agent-1': 'external-key',
      }),
      onMissingKey: failIfCalled,
      connectImpl: impl,
    });

    expect(calls[0]?.apiUrl).toBe('https://config.example');
  });
});
