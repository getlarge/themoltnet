/**
 * THESIS: One foreground server, one obvious control, details on demand.
 * OWN-WORLD: Matte control surfaces, teal runtime state, amber trust proof.
 * STORY: Make the server ready, operate it, inspect it, maintain it.
 * FIRST VIEWPORT: Server state and the single next action.
 * FORM: Compact native operations console; seed 2688504d.
 */
import {
  Badge,
  Button,
  ConfirmDialog,
  ControlSurface,
  Divider,
  InlineNotice,
  Logo,
  SignatureStatus,
  Stack,
  Text,
  useReducedMotion,
  useTheme,
} from '@themoltnet/design-system';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  desktopBridge,
  type DesktopStatus,
  INITIAL_STATUS,
  type LifecycleState,
} from './bridge.js';

const STATE_LABELS: Record<LifecycleState, string> = {
  checking: 'Checking local runtime',
  needs_install: 'Agent bundle required',
  installing: 'Installing agent bundle',
  needs_trust: 'Local HTTPS trust required',
  starting: 'Starting Agent Server',
  running: 'Agent Server running',
  update_available: 'Agent update available',
  stopping: 'Stopping Agent Server',
  stopped: 'Agent Server stopped',
  removed: 'Agent bundle removed',
  failed: 'Agent Server needs attention',
};

type Confirmation =
  | 'trust'
  | 'update'
  | 'desktop-update'
  | 'remove'
  | 'remove-ca'
  | null;

type OperationFeedback = {
  tone: 'error' | 'success';
  title: string;
  message: string;
};

type MainAction = {
  label: string;
  loadingLabel?: string;
  action: () => void;
};

function errorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error.trim()) return error;
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

export function App() {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const [status, setStatus] = useState<DesktopStatus>(INITIAL_STATUS);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<OperationFeedback | null>(null);
  const [desktopUpdateVersion, setDesktopUpdateVersion] = useState<
    string | null
  >(null);
  const operationInFlight = useRef(false);
  const confirmationInFlight = useRef(false);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    let unsubscribeRemove: (() => void) | undefined;
    void desktopBridge.status().then((next) => active && setStatus(next));
    void desktopBridge
      .subscribe((next) => active && setStatus(next))
      .then((unlisten) => {
        unsubscribe = unlisten;
      });
    void desktopBridge
      .subscribeRemoveRequest(() => {
        if (active) setConfirmation('remove');
      })
      .then((unlisten) => {
        unsubscribeRemove = unlisten;
      });
    return () => {
      active = false;
      unsubscribe?.();
      unsubscribeRemove?.();
    };
  }, []);

  const run = useCallback(
    async (
      operation: () => Promise<DesktopStatus>,
      successMessage?: string,
    ) => {
      if (operationInFlight.current) return;
      operationInFlight.current = true;
      setBusy(true);
      setFeedback(null);
      try {
        setStatus(await operation());
        if (successMessage) {
          setFeedback({
            tone: 'success',
            title: 'Complete',
            message: successMessage,
          });
        }
      } catch (error) {
        // Keep the original native payload in the WebView diagnostics.
        // eslint-disable-next-line no-console
        console.error(error);
        setFeedback({
          tone: 'error',
          title: 'Action could not be completed',
          message: errorMessage(error, 'Open diagnostics for more detail.'),
        });
      } finally {
        operationInFlight.current = false;
        setBusy(false);
      }
    },
    [],
  );

  const serverRunning = ['running', 'update_available'].includes(status.state);
  const setupRequired = [
    'checking',
    'needs_install',
    'installing',
    'needs_trust',
    'removed',
  ].includes(status.state);

  let mainAction: MainAction | null = null;
  if (status.state === 'needs_install' || status.state === 'removed') {
    mainAction = {
      label: 'Install agent bundle',
      loadingLabel: 'Installing agent bundle',
      action: () => void run(desktopBridge.install),
    };
  } else if (status.state === 'needs_trust') {
    mainAction = {
      label: 'Enable local HTTPS',
      action: () => setConfirmation('trust'),
    };
  } else if (serverRunning) {
    mainAction = {
      label: 'Open Console',
      action: () => void desktopBridge.openConsole(),
    };
  } else if (status.state === 'failed' || status.state === 'stopped') {
    mainAction = {
      label: 'Start Agent Server',
      loadingLabel: 'Starting Agent Server',
      action: () => void run(desktopBridge.start),
    };
  }

  const confirm = async () => {
    if (confirmationInFlight.current) return;
    confirmationInFlight.current = true;
    const action = confirmation;
    setConfirmation(null);
    try {
      switch (action) {
        case 'trust':
          await run(desktopBridge.trust);
          break;
        case 'update':
          await run(desktopBridge.installUpdate);
          break;
        case 'desktop-update':
          setBusy(true);
          setFeedback(null);
          try {
            await desktopBridge.installDesktopUpdate();
          } catch (error) {
            // eslint-disable-next-line no-console
            console.error(error);
            setFeedback({
              tone: 'error',
              title: 'Desktop update could not be installed',
              message: errorMessage(error, 'Try again from Maintenance.'),
            });
          } finally {
            setBusy(false);
          }
          break;
        case 'remove':
          await run(() => desktopBridge.remove(false));
          break;
        case 'remove-ca':
          await run(desktopBridge.removeTrust);
          break;
        case null:
          break;
      }
    } finally {
      confirmationInFlight.current = false;
    }
  };

  const checkDesktopUpdate = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const result = await desktopBridge.checkDesktopUpdate();
      setDesktopUpdateVersion(result.availableVersion);
      if (result.availableVersion) setConfirmation('desktop-update');
      else
        setFeedback({
          tone: 'success',
          title: 'App update status',
          message: result.message,
        });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(error);
      setFeedback({
        tone: 'error',
        title: 'Desktop update check failed',
        message: errorMessage(error, 'Try again from Maintenance.'),
      });
    } finally {
      setBusy(false);
    }
  };

  const stateVariant =
    status.state === 'failed'
      ? 'error'
      : serverRunning
        ? 'success'
        : status.state === 'needs_trust'
          ? 'warning'
          : 'default';

  return (
    <main
      id="main-content"
      tabIndex={-1}
      style={{
        minHeight: '100vh',
        padding: theme.spacing[6],
        background: theme.color.bg.void,
      }}
    >
      <Stack gap={6} style={{ maxWidth: '760px', margin: '0 auto' }}>
        <header className="app-header">
          <Stack direction="row" gap={4} align="center">
            <Logo size={48} glow={!reducedMotion && serverRunning} />
            <Stack gap={1} style={{ flex: 1 }}>
              <Text variant="h3">MoltNet Agent</Text>
              <Text color="secondary">
                Run and inspect the local Agent Server.
              </Text>
            </Stack>
            <SignatureStatus
              state={status.trusted ? 'verified' : 'pending'}
              label={status.trusted ? 'Local HTTPS trusted' : 'Trust pending'}
            />
          </Stack>
        </header>

        <ControlSurface
          as="section"
          tone={status.state === 'needs_trust' ? 'identity' : 'network'}
          active
          padding="lg"
          aria-labelledby="server-title"
        >
          <Stack gap={5}>
            <Stack gap={3}>
              <Stack
                direction="row"
                justify="space-between"
                align="center"
                wrap
              >
                <Text as="h1" id="server-title" variant="h3">
                  {STATE_LABELS[status.state]}
                </Text>
                <Badge variant={stateVariant}>
                  {status.state.replaceAll('_', ' ')}
                </Badge>
              </Stack>
              <Text color="secondary" aria-live="polite" aria-atomic="true">
                {status.message}
              </Text>
            </Stack>

            {setupRequired ? (
              <ol className="setup-path" aria-label="Agent setup progress">
                <li
                  data-complete={Boolean(status.installedVersion) || undefined}
                >
                  <span aria-hidden="true">1</span>
                  <Text as="span" variant="caption">
                    Agent bundle
                  </Text>
                </li>
                <li data-complete={status.trusted || undefined}>
                  <span aria-hidden="true">2</span>
                  <Text as="span" variant="caption">
                    Local trust
                  </Text>
                </li>
                <li data-complete={serverRunning || undefined}>
                  <span aria-hidden="true">3</span>
                  <Text as="span" variant="caption">
                    Server ready
                  </Text>
                </li>
              </ol>
            ) : null}

            {status.state === 'failed' ? (
              <InlineNotice tone="error" title="The server did not stay ready">
                The latest failure is preserved in Diagnostics. Fix the cause,
                then start the server again.
              </InlineNotice>
            ) : null}

            {feedback ? (
              <InlineNotice tone={feedback.tone} title={feedback.title}>
                {feedback.message}
              </InlineNotice>
            ) : null}

            <Stack direction="row" gap={3} wrap>
              {mainAction ? (
                <Button
                  onClick={mainAction.action}
                  loading={busy}
                  loadingLabel={mainAction.loadingLabel}
                >
                  {mainAction.label}
                </Button>
              ) : null}
              {serverRunning ? (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void run(desktopBridge.stop)}
                >
                  Stop Agent Server
                </Button>
              ) : null}
            </Stack>
          </Stack>
        </ControlSurface>

        <ControlSurface as="section" padding="none">
          <details
            className="detail-section"
            open={status.state === 'failed' ? true : undefined}
          >
            <summary>
              <span>
                <Text as="span" variant="h4">
                  Diagnostics
                </Text>
                <Text as="span" variant="caption" color="muted">
                  {status.logs.length
                    ? `${status.logs.length} recent log lines`
                    : 'No server output yet'}
                </Text>
              </span>
            </summary>
            <div className="detail-content">
              <pre
                className="log-preview"
                aria-label="Recent Agent Server logs"
              >
                {status.logs.length
                  ? status.logs.slice(-16).join('\n')
                  : 'No Agent Server output yet.'}
              </pre>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void desktopBridge.openLogs()}
              >
                Open full logs
              </Button>
            </div>
          </details>
        </ControlSurface>

        <ControlSurface as="section" padding="none">
          <details className="detail-section">
            <summary>
              <span>
                <Text as="span" variant="h4">
                  Maintenance
                </Text>
                <Text as="span" variant="caption" color="muted">
                  Updates, trust, and removal
                </Text>
              </span>
            </summary>
            <Stack className="detail-content" gap={5}>
              <Stack
                direction="row"
                justify="space-between"
                align="center"
                wrap
              >
                <Stack gap={1}>
                  <Text weight="semibold">Agent bundle</Text>
                  <Text mono variant="caption" color="muted">
                    {status.installedVersion
                      ? `Version ${status.installedVersion}`
                      : 'Not installed'}
                  </Text>
                </Stack>
                {status.state === 'update_available' ? (
                  <Button onClick={() => setConfirmation('update')}>
                    Install {status.availableVersion}
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy || !status.installedVersion}
                    onClick={() =>
                      void run(
                        desktopBridge.checkForUpdates,
                        'Agent bundle update check finished.',
                      )
                    }
                  >
                    Check bundle update
                  </Button>
                )}
              </Stack>

              <Divider style={{ margin: 0 }} />

              <Stack
                direction="row"
                justify="space-between"
                align="center"
                wrap
              >
                <Stack gap={1}>
                  <Text weight="semibold">Desktop app</Text>
                  <Text variant="caption" color="muted">
                    Signed builds use the production update channel.
                  </Text>
                </Stack>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() => void checkDesktopUpdate()}
                >
                  Check app update
                </Button>
              </Stack>

              <Divider style={{ margin: 0 }} />

              <Stack gap={3}>
                {status.trustFingerprint ? (
                  <Text mono variant="caption" color="accent">
                    Local CA {status.trustFingerprint}
                  </Text>
                ) : null}
                <Stack direction="row" gap={3} wrap>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!status.trusted || serverRunning}
                    onClick={() => setConfirmation('remove-ca')}
                  >
                    Remove local CA…
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => setConfirmation('remove')}
                  >
                    Remove agent bundle…
                  </Button>
                </Stack>
                {serverRunning ? (
                  <Text variant="caption" color="muted">
                    Stop the Agent Server before removing local trust.
                  </Text>
                ) : null}
              </Stack>
            </Stack>
          </details>
        </ControlSurface>

        <Text variant="caption" color="muted" align="center">
          Quitting MoltNet Agent stops the server. Configuration remains in
          ~/.config/moltnet.
        </Text>
      </Stack>

      <ConfirmDialog
        open={confirmation === 'trust'}
        title="Enable MoltNet local HTTPS?"
        message={`macOS will add this per-user CA to your login Keychain so Console can reach the local Agent Server securely. Fingerprint: ${status.trustFingerprint ?? 'preparing…'}`}
        confirmLabel="Trust local CA"
        onCancel={() => setConfirmation(null)}
        onConfirm={() => void confirm()}
      />
      <ConfirmDialog
        open={confirmation === 'update'}
        title="Install agent bundle update?"
        message={`Install verified bundle ${status.availableVersion ?? ''}, restart the server, and roll back automatically if readiness fails.`}
        confirmLabel="Install and restart"
        onCancel={() => setConfirmation(null)}
        onConfirm={() => void confirm()}
      />
      <ConfirmDialog
        open={confirmation === 'desktop-update'}
        title="Install MoltNet Agent app update?"
        message={`Install signed desktop update ${desktopUpdateVersion ?? ''} and restart the app. The agent bundle update channel is unchanged.`}
        confirmLabel="Install app update"
        onCancel={() => setConfirmation(null)}
        onConfirm={() => void confirm()}
      />
      <ConfirmDialog
        open={confirmation === 'remove'}
        title="Remove the agent bundle?"
        message="This stops the Agent Server and removes only the installer-owned bundle. Identities and provider configuration in ~/.config/moltnet are preserved."
        confirmLabel="Remove bundle"
        destructive
        onCancel={() => setConfirmation(null)}
        onConfirm={() => void confirm()}
      />
      <ConfirmDialog
        open={confirmation === 'remove-ca'}
        title="Remove local HTTPS trust?"
        message="Remove the per-user MoltNet local CA from the login Keychain. The agent bundle and ~/.config/moltnet configuration remain installed."
        confirmLabel="Remove local CA"
        cancelLabel="Keep local CA"
        destructive
        onCancel={() => setConfirmation(null)}
        onConfirm={() => void confirm()}
      />
    </main>
  );
}
