/**
 * AuthGuard — Protects routes that require authentication.
 *
 * Shows a loading state while checking session, redirects to the login flow
 * that can actually clear the current challenge, and renders children if
 * authenticated.
 */

import { Button, Card, Stack, Text } from '@themoltnet/design-system';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import { getConfig } from '../config.js';
import type { AuthChallenge } from './AuthProvider.js';
import { useAuth } from './useAuth.js';

/**
 * How many sign-in redirects we allow inside {@link REDIRECT_WINDOW_MS} before
 * concluding we are ping-ponging with Kratos and stopping to ask the user.
 *
 * A healthy flow costs one redirect and then leaves the user on the Kratos
 * form for seconds-to-minutes, so three inside thirty seconds only happens
 * when something is bouncing us straight back.
 */
const REDIRECT_LOOP_THRESHOLD = 3;
const REDIRECT_WINDOW_MS = 30_000;
const REDIRECT_STORAGE_KEY = 'moltnet.console.auth-redirects';

interface RedirectAttempts {
  firstAt: number;
  count: number;
}

/**
 * sessionStorage, not component or module state: every bounce through Kratos
 * is a full page load, so anything held in memory resets and the loop stays
 * invisible. It is also per-tab and dies with the tab, which is exactly the
 * lifetime "am I currently stuck" wants.
 *
 * All access is defensive — storage access throws in some privacy modes, and a
 * broken counter must never be the reason sign-in stops working.
 */
function readAttempts(): RedirectAttempts | null {
  try {
    const raw = window.sessionStorage.getItem(REDIRECT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RedirectAttempts>;
    if (
      typeof parsed.firstAt !== 'number' ||
      typeof parsed.count !== 'number'
    ) {
      return null;
    }
    return { firstAt: parsed.firstAt, count: parsed.count };
  } catch {
    return null;
  }
}

function writeAttempts(attempts: RedirectAttempts | null): void {
  try {
    if (attempts === null) {
      window.sessionStorage.removeItem(REDIRECT_STORAGE_KEY);
      return;
    }
    window.sessionStorage.setItem(
      REDIRECT_STORAGE_KEY,
      JSON.stringify(attempts),
    );
  } catch {
    // Storage unavailable — fall back to always redirecting.
  }
}

/** Records this page load's redirect and returns the running count. */
function recordRedirectAttempt(now: number): number {
  const previous = readAttempts();
  const withinWindow =
    previous !== null && now - previous.firstAt <= REDIRECT_WINDOW_MS;
  const next: RedirectAttempts = withinWindow
    ? { firstAt: previous.firstAt, count: previous.count + 1 }
    : { firstAt: now, count: 1 };
  writeAttempts(next);
  return next.count;
}

/**
 * Builds the absolute URL to return to after login, preserving the path, query
 * and hash the user was actually trying to reach.
 *
 * Kratos matches `allowed_return_urls` by scheme + host + path *prefix* (see
 * ory/kratos x/redir/secure_redirect.go), so the existing console origin entry
 * already covers every subpath — no Ory config change is required.
 *
 * `consoleUrl` carries no trailing slash, so this uses the URL constructor
 * rather than string concatenation to avoid producing "//tasks".
 */
function buildReturnTo(consoleUrl: string): string {
  const { pathname, search, hash } = window.location;
  return new URL(`${pathname}${search}${hash}`, consoleUrl).toString();
}

/**
 * Only follow a Kratos-supplied `redirect_browser_to` when it points back at
 * the Kratos we are configured to talk to. The value is server-controlled
 * today, but a navigation target read out of a response body is worth pinning.
 */
function sameOriginAsKratos(candidate: string, kratosUrl: string): boolean {
  try {
    return new URL(candidate).origin === new URL(kratosUrl).origin;
  } catch {
    return false;
  }
}

/**
 * Picks the login flow that can actually clear the current challenge.
 *
 * For `second_factor_required` the flow MUST carry `aal=aal2`. Without it
 * Kratos evaluates the existing aal1 session against a requested aal1,
 * concludes the user is already logged in, and 302s to `return_to` — putting
 * the console right back where it started. That is the redirect loop.
 */
export function buildSignInUrl({
  challenge,
  challengeRedirectTo,
  kratosUrl,
  consoleUrl,
}: {
  challenge: AuthChallenge;
  challengeRedirectTo: string | null;
  kratosUrl: string;
  consoleUrl: string;
}): string {
  const needsSecondFactor = challenge === 'second_factor_required';

  const url =
    needsSecondFactor &&
    challengeRedirectTo !== null &&
    sameOriginAsKratos(challengeRedirectTo, kratosUrl)
      ? new URL(challengeRedirectTo)
      : new URL('/self-service/login/browser', kratosUrl);

  if (needsSecondFactor && !url.searchParams.has('aal')) {
    url.searchParams.set('aal', 'aal2');
  }
  url.searchParams.set('return_to', buildReturnTo(consoleUrl));
  return url.toString();
}

export function AuthGuard({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading, challenge, challengeRedirectTo, logout } =
    useAuth();
  const [loopDetected, setLoopDetected] = useState(false);
  const hasRedirectedRef = useRef(false);

  const goToSignIn = useCallback(() => {
    const { kratosUrl, consoleUrl } = getConfig();
    // replace(), not assign(): each bounce through Kratos would otherwise push
    // a history entry, so a loop buries the page the user came from under
    // dozens of entries and Back walks *through* the loop instead of out of it.
    window.location.replace(
      buildSignInUrl({ challenge, challengeRedirectTo, kratosUrl, consoleUrl }),
    );
  }, [challenge, challengeRedirectTo]);

  useEffect(() => {
    if (isAuthenticated) writeAttempts(null);
  }, [isAuthenticated]);

  useEffect(() => {
    if (isLoading || isAuthenticated || loopDetected) return;
    // Redirecting is a side effect: done during render it fires once per render
    // pass, and navigation is async so there is always more than one pass.
    if (hasRedirectedRef.current) return;
    hasRedirectedRef.current = true;

    if (recordRedirectAttempt(Date.now()) > REDIRECT_LOOP_THRESHOLD) {
      setLoopDetected(true);
      return;
    }
    goToSignIn();
  }, [isLoading, isAuthenticated, loopDetected, goToSignIn]);

  if (isLoading) {
    return (
      <Stack align="center" justify="center" style={{ minHeight: '100vh' }}>
        <Text color="muted">Loading...</Text>
      </Stack>
    );
  }

  if (!isAuthenticated) {
    if (loopDetected) {
      return (
        <SignInRecovery
          challenge={challenge}
          onRetry={() => {
            writeAttempts(null);
            goToSignIn();
          }}
          onSignOut={() => {
            writeAttempts(null);
            void logout();
          }}
        />
      );
    }
    return null;
  }

  return <>{children}</>;
}

/**
 * Shown once the loop is detected, instead of redirecting a fourth time.
 *
 * "Sign out" is the control that matters: it ends the half-authenticated
 * session server-side. Mobile browsers offer no way to clear cookies for a
 * single domain, so without it a looping user has no way out at all.
 */
function SignInRecovery({
  challenge,
  onRetry,
  onSignOut,
}: {
  challenge: AuthChallenge;
  onRetry: () => void;
  onSignOut: () => void;
}) {
  const needsSecondFactor = challenge === 'second_factor_required';
  return (
    <Stack
      align="center"
      justify="center"
      style={{ minHeight: '100vh', padding: '1.5rem' }}
    >
      <Card style={{ maxWidth: '32rem' }}>
        <Stack gap={4}>
          <Text as="h1" variant="h3" data-testid="auth-loop-recovery">
            Sign-in could not complete
          </Text>
          <Text color="muted">
            {needsSecondFactor
              ? 'Your session is signed in but still needs two-factor verification. The console stopped retrying so you are not stuck in a redirect loop.'
              : 'The console was sent back to sign in repeatedly without a session being established, so it stopped retrying.'}
          </Text>
          <Stack direction="row" gap={3} wrap>
            <Button onClick={onRetry}>
              {needsSecondFactor ? 'Continue verification' : 'Try again'}
            </Button>
            <Button variant="secondary" onClick={onSignOut}>
              Sign out and start over
            </Button>
          </Stack>
          <Text color="muted" variant="caption">
            Signing out clears the session on the server — you do not need to
            clear cookies in your browser.
          </Text>
        </Stack>
      </Card>
    </Stack>
  );
}
