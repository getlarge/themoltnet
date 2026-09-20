/**
 * THESIS: Make foreground ownership visible; never disguise the agent as a service.
 * OWN-WORLD: Matte control surfaces, teal lifecycle flow, amber trust proof.
 * STORY: Inspect state, consent at protected transitions, continue in Console.
 * FIRST VIEWPORT: Server status and controls, diagnostics, advanced settings.
 * FORM: Lifecycle ledger; sixth grounded Operate structure, seed 2688504d.
 */
import {
  Button,
  ConfirmDialog,
  ControlSurface,
  InlineNotice,
  SignatureStatus,
  Stack,
  Text,
  useTheme,
} from '@themoltnet/design-system';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  desktopBridge,
  type DesktopStatus,
  INITIAL_STATUS,
  type LifecycleState,
} from './bridge.js';

import { ConnectionSettings } from './ConnectionSettings.js';

const STATE_LABELS: Record<LifecycleState, string> = {
  checking: 'Checking',
  needs_install: 'Agent bundle required',
  installing: 'Installing verified bundle',
  needs_trust: 'Local HTTPS trust required',
  starting: 'Starting Agent Server',
  running: 'Agent Server running',
  update_available: 'Update available',
  stopping: 'Stopping Agent Server',
  stopped: 'Agent Server stopped',
  removed: 'Agent bundle removed',
  failed: 'Action required',
};

const FLOW: readonly LifecycleState[] = [
  'checking',
  'needs_install',
  'installing',
  'needs_trust',
  'starting',
  'running',
] as const;

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

function errorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error.trim()) return error;
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

export function ServerPanel({ notice }: { notice?: ReactNode } = {}) {
  const [status, setStatus] = useState<DesktopStatus>(INITIAL_STATUS);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<OperationFeedback | null>(null);
  const operationInFlight = useRef(false);
  const confirmationInFlight = useRef(false);
  const [desktopUpdateVersion, setDesktopUpdateVersion] = useState<
    string | null
  >(null);

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
      if (operationInFlight.current) return false;
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
        // The native error remains useful in the WebView's diagnostic console.

        console.error(error);
        setFeedback({
          tone: 'error',
          title: 'Action could not be completed',
          message: errorMessage(error, 'Please review the logs.'),
        });
      } finally {
        operationInFlight.current = false;
        setBusy(false);
      }
      return true;
    },
    [],
  );

  const currentIndex = FLOW.indexOf(status.state);
  const statusTone =
    status.state === 'needs_trust'
      ? 'identity'
      : status.state === 'failed'
        ? 'neutral'
        : 'network';
  const primary = useMemo(() => {
    if (status.state === 'needs_install' || status.state === 'removed')
      return {
        label: 'Install verified agent',
        action: () => void run(desktopBridge.install),
      };
    if (status.state === 'needs_trust')
      return {
        label: 'Review local HTTPS trust',
        action: () => setConfirmation('trust'),
      };
    if (status.state === 'running' || status.state === 'update_available')
      return {
        label: 'Stop Agent Server',
        action: () => void run(desktopBridge.stop),
      };
    if (status.state === 'failed' || status.state === 'stopped')
      return {
        label: status.state === 'stopped' ? 'Start Agent Server' : 'Retry',
        action: () =>
          void run(
            status.state === 'stopped'
              ? desktopBridge.start
              : desktopBridge.retry,
          ),
      };
    return null;
  }, [run, status.state]);

  const confirm = async () => {
    if (confirmationInFlight.current || operationInFlight.current) return;
    confirmationInFlight.current = true;
    const action = confirmation;
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
            console.error(error);
            setFeedback({
              tone: 'error',
              title: 'Desktop update could not be installed',
              message: errorMessage(error, 'Please try again.'),
            });
          } finally {
            setBusy(false);
          }
          break;
        case 'remove':
          await run(desktopBridge.remove);
          break;
        case 'remove-ca':
          await run(desktopBridge.removeTrust);
          break;
        case null:
          break;
      }
    } finally {
      setConfirmation(null);
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
      console.error(error);
      setFeedback({
        tone: 'error',
        title: 'Desktop update check failed',
        message: errorMessage(error, 'Please try again.'),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Stack gap={6}>
        <header>
          <Stack direction="row" gap={4} align="center">
            <Stack gap={1} style={{ flex: 1 }}>
              <Text as="h1" variant="h4">
                Server
              </Text>
              <Text variant="caption" color="secondary">
                Secure local runtime for MoltNet agents.
              </Text>
            </Stack>
            <SignatureStatus
              state={status.trusted ? 'verified' : 'pending'}
              label={status.trusted ? 'Local HTTPS trusted' : 'Trust pending'}
            />
          </Stack>
        </header>

        <ControlSurface as="section" tone={statusTone} active padding="lg">
          <Stack gap={5}>
            <Stack gap={2}>
              <Text as="p" variant="overline" color="primary">
                Current state
              </Text>
              <Text as="h2" variant="h3">
                {STATE_LABELS[status.state]}
              </Text>
              <Text color="secondary" aria-live="polite" aria-atomic="true">
                {status.message}
              </Text>
              {notice}
            </Stack>

            {!status.installedVersion || status.state === 'needs_trust' ? (
              <Text variant="caption" color="secondary">
                {currentIndex >= 0
                  ? `Setup step ${currentIndex + 1} of ${FLOW.length}`
                  : STATE_LABELS[status.state]}
              </Text>
            ) : null}

            {status.state === 'failed' ? (
              <InlineNotice tone="error" title="The server did not stay ready">
                Review the bounded logs below, then retry. MoltNet will not
                adopt or stop a server owned by another process.
              </InlineNotice>
            ) : null}

            {feedback ? (
              <InlineNotice tone={feedback.tone} title={feedback.title}>
                {feedback.message}
              </InlineNotice>
            ) : null}

            <Stack direction="row" gap={3} wrap>
              {primary ? (
                <Button onClick={primary.action} loading={busy}>
                  {primary.label}
                </Button>
              ) : null}
              {status.state === 'running' ||
              status.state === 'update_available' ? (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void desktopBridge.openConsole()}
                >
                  Open Console
                </Button>
              ) : null}
            </Stack>
          </Stack>
        </ControlSurface>

        <ControlSurface
          as="section"
          padding="md"
          aria-labelledby="details-title"
        >
          <Stack gap={4}>
            <Stack direction="row" justify="space-between" align="center">
              <Text id="details-title" as="h2" variant="h4">
                Diagnostics and updates
              </Text>
              <Text mono variant="caption" color="muted">
                {status.installedVersion
                  ? `agent ${status.installedVersion}`
                  : 'not installed'}
              </Text>
            </Stack>
            <Stack direction="row" gap={3} wrap>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  status.state === 'update_available'
                    ? setConfirmation('update')
                    : void run(
                        desktopBridge.checkForUpdates,
                        'Agent CLI update check finished.',
                      )
                }
              >
                {status.state === 'update_available'
                  ? 'Review Agent CLI update'
                  : 'Check Agent CLI update'}
              </Button>
              <Button
                variant="ghost"
                onClick={() => void desktopBridge.openLogs()}
              >
                Open full logs
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => void checkDesktopUpdate()}
              >
                Check app update
              </Button>
            </Stack>
            {status.trustFingerprint ? (
              <Text
                mono
                variant="caption"
                color="accent"
                style={{ overflowWrap: 'anywhere' }}
              >
                Local CA {status.trustFingerprint}
              </Text>
            ) : null}
            <pre className="log-preview" aria-label="Recent Agent Server logs">
              {status.logs.length
                ? status.logs.slice(-12).join('\n')
                : 'No Agent Server output yet.'}
            </pre>
            <details>
              <summary>Maintenance</summary>
              <Stack
                direction="row"
                justify="space-between"
                align="center"
                wrap
              >
                <Text variant="caption" color="muted">
                  Quitting this app stops the Agent Server. Configuration stays
                  in ~/.config/moltnet.
                </Text>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy || !status.trustFingerprint}
                  onClick={() => setConfirmation('remove-ca')}
                >
                  Remove local CA…
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={busy}
                  onClick={() => setConfirmation('remove')}
                >
                  Remove agent bundle
                </Button>
              </Stack>{' '}
            </details>
          </Stack>
        </ControlSurface>
        <ControlSurface as="section" padding="md">
          <ConnectionSettings
            running={
              status.state === 'running' || status.state === 'update_available'
            }
            busy={busy}
            apply={run}
          />
        </ControlSurface>
      </Stack>

      <ConfirmDialog
        open={confirmation === 'trust'}
        title="Trust MoltNet local HTTPS?"
        message={`macOS will add this per-user CA to your login Keychain so Console can reach the local Agent Server securely. Fingerprint: ${status.trustFingerprint ?? 'preparing…'}`}
        confirmLabel="Trust local CA"
        onCancel={() => setConfirmation(null)}
        onConfirm={() => void confirm()}
      />
      <ConfirmDialog
        open={confirmation === 'update'}
        title="Install agent update?"
        message={`Install the verified agent bundle ${status.availableVersion ?? ''}, restart the foreground server, and roll back automatically if readiness fails.`}
        confirmLabel="Install and restart"
        onCancel={() => setConfirmation(null)}
        onConfirm={() => void confirm()}
      />
      <ConfirmDialog
        open={confirmation === 'desktop-update'}
        title="Install MoltNet Agent app update?"
        message={`Install the independently signed desktop update ${desktopUpdateVersion ?? ''} and restart the app. The agent bundle update channel is unchanged.`}
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
        title="Also remove local HTTPS trust?"
        message="Remove only the per-user MoltNet local CA from the login Keychain. The agent bundle and ~/.config/moltnet configuration remain installed."
        confirmLabel="Remove local CA"
        cancelLabel="Keep local CA"
        destructive
        onCancel={() => setConfirmation(null)}
        onConfirm={() => void confirm()}
      />
    </>
  );
}

/**
 * Entry component. Owns the window chrome so `ServerPanel` can also be
 * rendered inside a shell that already provides `<main>` and its own padding.
 */
export function App() {
  const theme = useTheme();
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
      <div style={{ margin: '0 auto', maxWidth: '760px' }}>
        <ServerPanel />
      </div>
    </main>
  );
}
