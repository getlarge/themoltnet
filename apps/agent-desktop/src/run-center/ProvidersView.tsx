/**
 * Provider credentials for this machine.
 *
 * This is the remedy the composer's readiness blockers point at: a profile
 * that needs `ANTHROPIC_API_KEY` is unrunnable until a key exists here, and
 * sending the operator to Console mid-compose is the friction the desktop app
 * exists to remove.
 *
 * A key is write-only by construction. The server answers with `hasApiKey`
 * booleans and never echoes a secret back, so this surface can report that a
 * provider is configured without ever being able to display what was stored.
 */
import {
  Badge,
  Button,
  ConfirmDialog,
  ControlSurface,
  EmptyState,
  InlineNotice,
  Input,
  Stack,
  Text,
} from '@themoltnet/design-system';
import { useState } from 'react';

import type { AgentServerProvider, ProviderActions } from './types.js';

export interface ProvidersViewProps {
  providers: Record<string, AgentServerProvider>;
  actions: ProviderActions;
  /** Called after a change so the caller can refresh its catalogue. */
  onChanged: () => void;
}

export function ProvidersView({
  providers,
  actions,
  onChanged,
}: ProvidersViewProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const entries = Object.entries(providers);

  const save = async (providerId: string, provider: AgentServerProvider) => {
    if (!apiKey.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await actions.putProvider(providerId, {
        api: provider.api,
        baseUrl: provider.baseUrl,
        envName: provider.envName,
        models: provider.models,
        apiKey: apiKey.trim(),
      });
      // Drop the secret as soon as it is handed over: component state is one
      // more place it could be read from.
      setApiKey('');
      setEditing(null);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (providerId: string) => {
    setRemoving(null);
    setBusy(true);
    setError(null);
    try {
      await actions.deleteProvider(providerId);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack gap={6}>
      <Stack gap={1}>
        <Text as="h1" variant="h4">
          Providers
        </Text>
        <Text variant="caption" color="secondary">
          Model credentials held on this Mac. A runtime profile names the
          provider it needs; without a key here, a run using it cannot start.
        </Text>
      </Stack>

      {error ? (
        <InlineNotice tone="error" title="That did not work">
          {error}
        </InlineNotice>
      ) : null}

      {entries.length === 0 ? (
        <ControlSurface padding="lg">
          <EmptyState
            title="No providers configured on this machine"
            description="Add the key for the provider your runtime profiles use. Keys stay on this Mac; MoltNet never sends them anywhere else."
          />
        </ControlSurface>
      ) : (
        <Stack gap={3}>
          {entries.map(([providerId, provider]) => (
            <ControlSurface key={providerId} as="article" padding="md">
              <Stack gap={4}>
                <Stack
                  direction="row"
                  justify="space-between"
                  align="flex-start"
                  gap={4}
                  wrap
                >
                  <Stack gap={1} style={{ minWidth: 0 }}>
                    <Text as="h2" variant="bodyLarge" weight="semibold" mono>
                      {provider.api}
                    </Text>
                    <Text variant="caption" color="muted" mono>
                      {provider.envName}
                    </Text>
                  </Stack>
                  <Badge variant={provider.hasApiKey ? 'success' : 'warning'}>
                    {provider.hasApiKey ? 'key configured' : 'no key'}
                  </Badge>
                </Stack>

                {editing === providerId ? (
                  <Stack gap={3}>
                    <Input
                      label="API key"
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      value={apiKey}
                      hint="Stored on this Mac. It is never shown again after saving."
                      onChange={(event) => setApiKey(event.target.value)}
                    />
                    <Stack direction="row" gap={3}>
                      <Button
                        size="sm"
                        loading={busy}
                        loadingLabel="Saving key"
                        onClick={() => void save(providerId, provider)}
                      >
                        Save key
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          setApiKey('');
                          setEditing(null);
                        }}
                      >
                        Cancel
                      </Button>
                    </Stack>
                  </Stack>
                ) : (
                  <Stack direction="row" gap={2} wrap>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        setApiKey('');
                        setError(null);
                        setEditing(providerId);
                      }}
                    >
                      {provider.hasApiKey
                        ? `Replace key for ${provider.api}`
                        : `Add key for ${provider.api}`}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => setRemoving(providerId)}
                    >
                      Remove {provider.api}
                    </Button>
                  </Stack>
                )}
              </Stack>
            </ControlSurface>
          ))}
        </Stack>
      )}

      <ConfirmDialog
        open={removing !== null}
        title={`Remove ${removing ?? ''}?`}
        message="This deletes the provider and the API key held for it on this Mac. Runtime profiles that need it will stop being runnable here until you add it again."
        confirmLabel="Remove provider"
        destructive
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) void remove(removing);
        }}
      />
    </Stack>
  );
}
