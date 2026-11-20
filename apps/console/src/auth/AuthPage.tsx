import '@ory/elements-react/theme/styles.css';
import './auth.css';

import type {
  OryClientConfiguration,
  OryErrorHandler,
  OrySuccessHandler,
} from '@ory/elements-react';
import { SessionProvider } from '@ory/elements-react/client';
import {
  Error as OryError,
  Login,
  Recovery,
  Registration,
  Settings,
  Verification,
} from '@ory/elements-react/theme';
import { Button, Logo, Stack, Text, useTheme } from '@themoltnet/design-system';
import { type CSSProperties, useEffect, useRef, useState } from 'react';

import { ThemeToggle } from '../components/ThemeToggle.js';
import { getConfig } from '../config.js';
import { getKratosClient } from '../kratos.js';
import { AccessibleTotp } from './AccessibleTotp.js';
import {
  clearFlowRestart,
  flowFailure,
  flowSearch,
  type LoadedFlow,
  loadFlow,
  logoutOAuthSession,
  navigateToOryRedirect,
  rememberFlowRestart,
} from './flows.js';
import {
  type AuthPage as PageKind,
  authUrl,
  getOryConfig,
} from './ory-config.js';
import { useAuth } from './useAuth.js';

type State =
  | { kind: 'loading' }
  | { kind: 'flow'; loaded: LoadedFlow }
  | {
      kind: 'error';
      error: Awaited<
        ReturnType<ReturnType<typeof getKratosClient>['getFlowError']>
      >;
    }
  | { kind: 'failed'; message: string };

export function AuthPage({ page }: { page: PageKind }) {
  const theme = useTheme();
  const { session, refreshSession, logout, error: sessionError } = useAuth();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const main = useRef<HTMLElement>(null);
  const config = getOryConfig();

  useEffect(() => {
    main.current?.focus();
    if (page === 'logout') return;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
      setState({
        kind: 'failed',
        message: 'Loading this form took too long. Please try again.',
      });
    }, 15_000);
    setState({ kind: 'loading' });
    setNotice(null);
    const search =
      page === 'error'
        ? new URLSearchParams(window.location.search)
        : flowSearch(page);
    const run = async () => {
      if (page === 'error') {
        const id = search.get('id');
        if (!id) {
          setState({
            kind: 'failed',
            message: 'Sign-in could not complete. Please start again.',
          });
          return;
        }
        const error = await getKratosClient().getFlowError(
          { id },
          { signal: controller.signal },
        );
        if (!controller.signal.aborted) setState({ kind: 'error', error });
        return;
      }
      let loaded: LoadedFlow;
      try {
        loaded = await loadFlow(page, search, controller.signal);
      } catch (error) {
        const failure = await flowFailure(error);
        if (failure?.body.redirect_browser_to) {
          if (!controller.signal.aborted)
            navigateToOryRedirect(failure.body.redirect_browser_to);
          return;
        }
        if (!failure || ![403, 404, 410].includes(failure.status)) throw error;
        if (failure.body.use_flow_id)
          search.set('flow', failure.body.use_flow_id);
        else search.delete('flow');
        // Retry only once. Rejected redirects or policy errors must stay visible.
        loaded = await loadFlow(page, search, controller.signal);
        setNotice(
          'Your previous form expired or could not be verified. Please try again.',
        );
      }
      if (controller.signal.aborted) return;
      // Preserve initialization parameters for a later restart, including when
      // arriving from Ory with only ?flow= (social, MFA and OAuth callbacks).
      const original = new URL(loaded.flow.request_url ?? window.location.href)
        .searchParams;
      for (const [key, value] of original) {
        if (!search.has(key)) search.set(key, value);
      }
      search.set('flow', loaded.flow.id);
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}?${search}`,
      );
      clearFlowRestart();
      setState({ kind: 'flow', loaded });
    };
    void run()
      .catch(() => {
        if (!controller.signal.aborted) {
          setState({
            kind: 'failed',
            message:
              'The form could not be started. Try again or return to sign-in.',
          });
        }
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [page, attempt]);

  const onError: OryErrorHandler = (event) => {
    if (event.type === 'unexpected_error') {
      setNotice('This request could not complete. Please try again.');
    } else if (
      event.type === 'csrf_error' ||
      event.type === 'flow_expired' ||
      event.type === 'flow_not_found' ||
      event.type === 'flow_replaced'
    ) {
      if (
        page !== 'error' &&
        page !== 'logout' &&
        !(event.type === 'flow_expired' && event.body.use_flow_id)
      ) {
        rememberFlowRestart(page);
      }
      setNotice(
        'Your form expired or could not be verified. Please try again.',
      );
    }
  };
  const props = {
    config,
    components: { Form: { TotpSettings: AccessibleTotp } },
    onError,
    onSuccess: async () => {
      await refreshSession();
    },
  };
  const style = {
    '--auth-bg': theme.color.bg.void,
    '--auth-surface': theme.color.bg.surface,
    '--auth-elevated': theme.color.bg.elevated,
    '--auth-text': theme.color.text.DEFAULT,
    '--auth-muted': theme.color.text.muted,
    '--auth-inverse': theme.color.text.inverse,
    '--auth-primary': theme.color.primary.DEFAULT,
    '--auth-hover': theme.color.primary.hover,
    '--auth-subtle': theme.color.primary.muted,
    '--auth-border': theme.color.border.DEFAULT,
    '--auth-error': theme.color.error.DEFAULT,
    '--auth-success': theme.color.success.DEFAULT,
    '--auth-font': theme.font.family.sans,
    '--auth-radius': theme.radius.lg,
    height: '100%',
    overflow: 'auto',
    background: theme.color.bg.void,
    color: theme.color.text.DEFAULT,
    padding: theme.spacing[4],
  } as CSSProperties;

  return (
    <div className="auth-shell" style={style}>
      <a className="auth-skip" href="#auth-main">
        Skip to form
      </a>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: theme.spacing[4],
        }}
      >
        <a href={getConfig().consoleUrl} aria-label="MoltNet Console">
          <Logo size={32} />
        </a>
        <ThemeToggle />
      </header>
      <main
        ref={main}
        id="auth-main"
        tabIndex={-1}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          paddingBlock: theme.spacing[8],
          gap: theme.spacing[4],
        }}
      >
        {notice && (
          <div role="alert">
            <Text>{notice}</Text>
          </div>
        )}
        {page === 'logout' ? (
          <Stack gap={4} align="center">
            <Text as="h1" variant="h2">
              Sign out
            </Text>
            <Text>End your MoltNet session on this browser.</Text>
            {sessionError && (
              <div role="alert">
                <Text>
                  Unable to sign out. Check your connection and try again.
                </Text>
              </div>
            )}
            <Button
              disabled={isLoggingOut}
              onClick={() => {
                setIsLoggingOut(true);
                const challenge = new URLSearchParams(
                  window.location.search,
                ).get('logout_challenge');
                void (challenge ? logoutOAuthSession(challenge) : logout())
                  .catch(() =>
                    setNotice('Sign-out could not complete. Please try again.'),
                  )
                  .finally(() => setIsLoggingOut(false));
              }}
            >
              Sign out
            </Button>
            <a href={getConfig().consoleUrl}>Return to console</a>
          </Stack>
        ) : state.kind === 'loading' ? (
          <div role="status">
            <Text>Loading your form…</Text>
          </div>
        ) : state.kind === 'failed' ? (
          <Stack gap={4} align="center">
            <Text as="h1" variant="h2">
              Unable to continue
            </Text>
            <div role="alert">
              <Text>{state.message}</Text>
            </div>
            <Button onClick={() => setAttempt((value) => value + 1)}>
              Try again
            </Button>
            <a href={authUrl('login')}>Start sign-in again</a>
          </Stack>
        ) : state.kind === 'error' ? (
          <OryError
            error={state.error}
            config={config}
            session={session ?? undefined}
          />
        ) : (
          <FlowView
            key={state.loaded.flow.id}
            loaded={state.loaded}
            props={props}
            session={session}
          />
        )}
      </main>
    </div>
  );
}

function FlowView({
  loaded,
  props,
  session,
}: {
  loaded: LoadedFlow;
  props: {
    components: Parameters<typeof Login>[0]['components'];
    config: OryClientConfiguration;
    onError: OryErrorHandler;
    onSuccess: OrySuccessHandler;
  };
  session: ReturnType<typeof useAuth>['session'];
}) {
  switch (loaded.kind) {
    case 'login':
      return <Login {...props} flow={loaded.flow} />;
    case 'registration':
      return <Registration {...props} flow={loaded.flow} />;
    case 'recovery':
      return <Recovery {...props} flow={loaded.flow} />;
    case 'verification':
      return <Verification {...props} flow={loaded.flow} />;
    case 'settings':
      return (
        <SessionProvider
          session={session ?? undefined}
          baseUrl={getConfig().kratosUrl}
        >
          <Settings {...props} flow={loaded.flow} />
        </SessionProvider>
      );
  }
}
