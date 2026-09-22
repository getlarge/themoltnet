import {
  Button,
  ConfirmDialog,
  InlineNotice,
  Input,
  Stack,
  Text,
} from '@themoltnet/design-system';
import { useState } from 'react';

import {
  type ConnectionSettings as Settings,
  type ConnectionSettingsView,
  desktopBridge,
  type DesktopStatus,
} from './bridge.js';

const LABELS: Record<keyof Settings, string> = {
  apiUrl: 'MoltNet API URL',
  issuer: 'OAuth issuer',
  publicUrl: 'OAuth public URL',
  nativeClientId: 'Desktop OAuth client ID',
};

export function ConnectionSettings({
  running,
  busy,
  apply,
}: {
  running: boolean;
  busy: boolean;
  apply: (
    operation: () => Promise<DesktopStatus>,
    message?: string,
  ) => Promise<boolean>;
}) {
  const [view, setView] = useState<ConnectionSettingsView | null>(null);
  const [draft, setDraft] = useState<Partial<Settings>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await desktopBridge.connectionSettings();
      setView(next);
      setDraft(next.overrides);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setLoading(false);
    }
  };
  const field = (key: keyof Settings) => {
    if (!view) return null;
    const managed = view.environment[key] !== undefined;
    return (
      <Input
        key={key}
        label={LABELS[key]}
        value={
          managed ? view.environment[key] : (draft[key] ?? view.defaults[key])
        }
        disabled={busy || managed}
        hint={
          managed
            ? 'Managed by the launch environment.'
            : `Release default: ${view.defaults[key]}`
        }
        onChange={(event) =>
          setDraft((current) => ({ ...current, [key]: event.target.value }))
        }
      />
    );
  };
  const dirty =
    view && JSON.stringify(draft) !== JSON.stringify(view.overrides);
  return (
    <details
      onToggle={(event) => {
        if (event.currentTarget.open && running && !view && !loading)
          void load();
      }}
    >
      <summary>Advanced connection settings</summary>
      <Stack gap={4} style={{ paddingTop: '1rem' }}>
        <Text variant="caption" color="secondary">
          For self-hosted or development environments. Changes restart the
          server and require sign-in again. Stop running work first.
        </Text>
        {!running ? (
          <Text>Start the Agent Server to manage its connection settings.</Text>
        ) : (
          <>
            {error ? (
              <InlineNotice
                tone="error"
                title="Could not load connection settings"
              >
                {error}
              </InlineNotice>
            ) : null}
            {!view ? (
              <Button
                variant="secondary"
                loading={loading}
                onClick={() => void load()}
              >
                Load connection settings
              </Button>
            ) : (
              <>
                {field('apiUrl')}
                {field('issuer')}
                <details>
                  <summary>OAuth endpoints and client IDs</summary>
                  <Stack gap={3} style={{ paddingTop: '1rem' }}>
                    {field('publicUrl')}
                    {field('nativeClientId')}
                  </Stack>
                </details>
                <Stack direction="row" gap={3} wrap>
                  <Button
                    disabled={busy || !dirty}
                    onClick={() => setConfirming(true)}
                  >
                    Apply and restart server
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      setDraft(
                        Object.fromEntries(
                          Object.entries(view.overrides).filter(
                            ([key]) =>
                              view.environment[key as keyof Settings] !==
                              undefined,
                          ),
                        ),
                      )
                    }
                  >
                    Reset to release defaults
                  </Button>
                  {dirty ? (
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => setDraft(view.overrides)}
                    >
                      Discard changes
                    </Button>
                  ) : null}
                </Stack>
              </>
            )}
          </>
        )}
      </Stack>
      <ConfirmDialog
        open={confirming}
        title="Apply connection settings and restart?"
        message="The server will restart and require a new operator sign-in. Credentials for another API or issuer stay in their original environment. Running work must be stopped before applying."
        confirmLabel="Apply and restart"
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          void apply(async () => {
            const status = await desktopBridge.applyConnectionSettings(draft);
            setView(null);
            return status;
          }, 'Connection settings applied. Sign in to authorize local control.');
        }}
      />
    </details>
  );
}
