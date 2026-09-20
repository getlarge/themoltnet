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

import { ProviderForm } from './ProviderForm.js';
import type {
  AgentServerProvider,
  AgentServerSubscription,
  AgentServerSubscriptionLogin,
  ProviderActions,
  SubscriptionActions,
} from './types.js';

/** The provider's own polling cadence, and a bound so a stall ends. */
const POLL_INTERVAL_MS = 2_000;
const POLL_DEADLINE_MS = 5 * 60_000;

export interface ProvidersViewProps {
  providers: Record<string, AgentServerProvider>;
  actions: ProviderActions;
  subscriptions?: AgentServerSubscription[];
  subscriptionActions?: SubscriptionActions;
  /** Called after a change so the caller can refresh its catalogue. */
  onChanged: () => void;
}

export function ProvidersView({
  providers,
  actions,
  subscriptions = [],
  subscriptionActions,
  onChanged,
}: ProvidersViewProps) {
  const [configuring, setConfiguring] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const entries = Object.entries(providers);
  const [login, setLogin] = useState<AgentServerSubscriptionLogin | null>(null);
  const [signingIn, setSigningIn] = useState<string | null>(null);

  const signIn = async (providerId: string) => {
    if (!subscriptionActions) return;
    setSigningIn(providerId);
    setError(null);
    setLogin(null);
    try {
      let current = await subscriptionActions.startLogin(providerId);
      setLogin(current);
      if (current.status === 'failed') {
        setError(current.error ?? 'The provider refused the sign-in.');
        return;
      }
      // Native code can open the page after an await; a browser cannot,
      // because a popup outside the click gesture is blocked.
      const target = current.verificationUri ?? current.authUrl;
      if (target) await subscriptionActions.openSignIn(target);

      const deadline = Date.now() + POLL_DEADLINE_MS;
      while (current.status === 'pending' && Date.now() < deadline) {
        await new Promise((resolve) => {
          setTimeout(resolve, POLL_INTERVAL_MS);
        });
        current = await subscriptionActions.loginStatus(providerId);
        setLogin(current);
      }
      if (current.status === 'failed') {
        setError(current.error ?? 'The provider refused the sign-in.');
        return;
      }
      if (current.status === 'completed') {
        setLogin(null);
        onChanged();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSigningIn(null);
    }
  };

  const abandonSignIn = async (providerId: string) => {
    if (!subscriptionActions) return;
    setLogin(null);
    setSigningIn(null);
    try {
      await subscriptionActions.cancelLogin(providerId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

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
          Connect local models or a cloud provider, then choose the models your
          runtime profiles can use. Credentials are stored on this Mac.
        </Text>
      </Stack>

      {error ? (
        <InlineNotice tone="error" title="That did not work">
          {error}
        </InlineNotice>
      ) : null}

      {configuring !== null ? (
        <ControlSurface padding="lg">
          <ProviderForm
            key={configuring}
            providers={providers}
            actions={actions}
            existingId={configuring || undefined}
            onChanged={onChanged}
            onDone={() => setConfiguring(null)}
          />
        </ControlSurface>
      ) : (
        <Stack direction="row">
          <Button onClick={() => setConfiguring('')}>Add provider</Button>
        </Stack>
      )}

      {entries.length === 0 && configuring === null ? (
        <ControlSurface padding="lg">
          <EmptyState
            title="No providers configured on this machine"
            description="Add Ollama, Ollama Cloud, or another OpenAI-compatible provider to use its models from Desktop."
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
                      {providerId}
                    </Text>
                    <Text variant="caption" color="muted" mono>
                      {provider.envName}
                    </Text>
                  </Stack>
                  <Badge variant={provider.hasApiKey ? 'success' : 'default'}>
                    {provider.hasApiKey ? 'key configured' : 'no key stored'}
                  </Badge>
                </Stack>

                <Text variant="caption" color="secondary">
                  {provider.models.length
                    ? `${provider.models.length} models saved for runtime profiles`
                    : 'No models saved. Choose models to finish setup.'}
                </Text>

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
                      disabled={busy || configuring !== null}
                      onClick={() => setConfiguring(providerId)}
                    >
                      Configure models for {providerId}
                    </Button>
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
                        ? `Replace key for ${providerId}`
                        : `Add key for ${providerId}`}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => setRemoving(providerId)}
                    >
                      Remove {providerId}
                    </Button>
                  </Stack>
                )}
              </Stack>
            </ControlSurface>
          ))}
        </Stack>
      )}

      {subscriptionActions && subscriptions.length > 0 ? (
        <Stack gap={3}>
          <Text variant="overline" color="muted">
            Subscriptions
          </Text>
          <Text variant="caption" color="secondary">
            Sign in with a plan you already pay for, instead of managing an API
            key. The sign-in happens on the provider&apos;s site; MoltNet never
            sees your password.
          </Text>
          {subscriptions.map((subscription) => (
            <ControlSurface key={subscription.id} as="article" padding="md">
              <Stack gap={4}>
                <Stack
                  direction="row"
                  justify="space-between"
                  align="center"
                  gap={4}
                  wrap
                >
                  <Text as="h2" variant="bodyLarge" weight="semibold">
                    {subscription.name}
                  </Text>
                  {subscription.connected ? (
                    <Badge variant="success">signed in</Badge>
                  ) : (
                    <Button
                      size="sm"
                      loading={signingIn === subscription.id}
                      loadingLabel="Waiting for the provider"
                      onClick={() => void signIn(subscription.id)}
                    >
                      Sign in to {subscription.name}
                    </Button>
                  )}
                </Stack>

                {login &&
                login.providerId === subscription.id &&
                login.status === 'pending' ? (
                  <Stack gap={3}>
                    {login.userCode ? (
                      <Stack gap={1}>
                        <Text variant="caption" color="secondary">
                          Enter this code on the page that just opened:
                        </Text>
                        <Text as="p" variant="h3" mono>
                          {login.userCode}
                        </Text>
                      </Stack>
                    ) : null}
                    {login.instructions ? (
                      <Text variant="caption" color="secondary">
                        {login.instructions}
                      </Text>
                    ) : null}
                    {login.verificationUri ? (
                      <Text variant="caption" color="muted" mono>
                        {login.verificationUri}
                      </Text>
                    ) : null}
                    <Stack direction="row">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void abandonSignIn(subscription.id)}
                      >
                        Cancel sign-in
                      </Button>
                    </Stack>
                  </Stack>
                ) : null}
              </Stack>
            </ControlSurface>
          ))}
        </Stack>
      ) : null}

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
