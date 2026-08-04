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
 * Query parameter the console asks Kratos to echo back on `return_to`, and the
 * sessionStorage key holding the value we are currently expecting.
 *
 * Together they answer one question directly: *did the login flow we just sent
 * the browser into hand it straight back to us?* If it did, and we still have
 * no usable session, that flow cannot fix the problem and re-entering it would
 * ping-pong forever.
 *
 * This replaces counting redirects. A counter cannot tell a genuine loop from
 * a user navigating back and forth, needs a threshold and a time window that
 * are both guesses, and only gives up after several wasted bounces. The
 * sentinel is causal, fires on the first proven bounce, and has nothing to
 * tune.
 *
 * The token is a nonce rather than a fixed marker so that a `_authhop` pasted
 * into a shared or bookmarked URL cannot strand an otherwise-fine visitor on
 * the recovery screen.
 */
const HOP_PARAM = '_authhop';
const HOP_STORAGE_KEY = 'moltnet.console.auth-hop';

/**
 * sessionStorage, not component or module state: the round trip through Kratos
 * is a full page load, so anything held in memory is gone by the time the
 * answer arrives. It is also per-tab and dies with the tab, which is exactly
 * the lifetime "am I mid-sign-in right now" wants.
 *
 * All access is defensive — storage throws in some privacy modes, and a broken
 * sentinel must never be the reason sign-in stops working. Failing to read it
 * degrades to "always redirect", i.e. the behaviour without this guard.
 */
function readHopToken(): string | null {
  try {
    return window.sessionStorage.getItem(HOP_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeHopToken(token: string | null): void {
  try {
    if (token === null) {
      window.sessionStorage.removeItem(HOP_STORAGE_KEY);
      return;
    }
    window.sessionStorage.setItem(HOP_STORAGE_KEY, token);
  } catch {
    // Storage unavailable — fall back to always redirecting.
  }
}

function newHopToken(): string {
  return typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Where the user was trying to go, with the sentinel taken back out. */
interface Arrival {
  /** The `_authhop` Kratos echoed back on this load, if any. */
  returnedHop: string | null;
  pathname: string;
  search: string;
  hash: string;
}

/**
 * Reads the current location and separates the sentinel from the destination.
 *
 * Pure: stripping the parameter from the address bar is a side effect and
 * happens in an effect instead, so React may call this more than once (it does
 * under StrictMode) without the second call losing the sentinel.
 */
function parseArrival(): Arrival {
  const { pathname, search, hash } = window.location;
  const params = new URLSearchParams(search);
  const returnedHop = params.get(HOP_PARAM);
  if (returnedHop === null) {
    return { returnedHop: null, pathname, search, hash };
  }
  params.delete(HOP_PARAM);
  const rest = params.toString();
  return { returnedHop, pathname, search: rest ? `?${rest}` : '', hash };
}

/**
 * Builds the absolute URL to return to after login, preserving the path, query
 * and hash the user was actually trying to reach, and tagging it so we can
 * recognise our own round trip when Kratos sends the browser back.
 *
 * Kratos matches `allowed_return_urls` by scheme + host + path *prefix* (see
 * ory/kratos x/redir/secure_redirect.go), so the existing console origin entry
 * already covers every subpath and the extra query parameter is not part of
 * the match — no Ory config change is required.
 *
 * `consoleUrl` carries no trailing slash, so this uses the URL constructor
 * rather than string concatenation to avoid producing "//tasks".
 */
function buildReturnTo(
  consoleUrl: string,
  { pathname, search, hash }: Pick<Arrival, 'pathname' | 'search' | 'hash'>,
  hop: string,
): string {
  const url = new URL(`${pathname}${search}${hash}`, consoleUrl);
  url.searchParams.set(HOP_PARAM, hop);
  return url.toString();
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
  destination,
  hop,
}: {
  challenge: AuthChallenge;
  challengeRedirectTo: string | null;
  kratosUrl: string;
  consoleUrl: string;
  /** Where to come back to, with any previous sentinel already stripped. */
  destination: Pick<Arrival, 'pathname' | 'search' | 'hash'>;
  /** Sentinel Kratos will echo back on `return_to`. */
  hop: string;
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
  url.searchParams.set(
    'return_to',
    buildReturnTo(consoleUrl, destination, hop),
  );
  return url.toString();
}

export function AuthGuard({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading, challenge, challengeRedirectTo, logout } =
    useAuth();
  const [loopDetected, setLoopDetected] = useState(false);
  const hasRedirectedRef = useRef(false);
  // Both captured once, at mount, before anything can clear or rewrite them.
  const [arrival] = useState(parseArrival);
  const [expectedHop] = useState(readHopToken);

  /**
   * True when Kratos returned the browser to a URL we tagged on the way out
   * and the session still is not usable. The flow we chose demonstrably cannot
   * clear this challenge, so going back into it is the loop.
   */
  const bouncedBack =
    arrival.returnedHop !== null && arrival.returnedHop === expectedHop;

  const goToSignIn = useCallback(() => {
    const { kratosUrl, consoleUrl } = getConfig();
    const hop = newHopToken();
    writeHopToken(hop);
    // replace(), not assign(): each bounce through Kratos would otherwise push
    // a history entry, so a loop buries the page the user came from under
    // dozens of entries and Back walks *through* the loop instead of out of it.
    window.location.replace(
      buildSignInUrl({
        challenge,
        challengeRedirectTo,
        kratosUrl,
        consoleUrl,
        destination: arrival,
        hop,
      }),
    );
  }, [challenge, challengeRedirectTo, arrival]);

  // Keep the sentinel out of the address bar: it is machinery, and a user who
  // bookmarks or shares the URL should not carry it along.
  useEffect(() => {
    if (arrival.returnedHop === null) return;
    try {
      window.history.replaceState(
        null,
        '',
        `${arrival.pathname}${arrival.search}${arrival.hash}`,
      );
    } catch {
      // Cosmetic only — the sentinel is already read and never re-read.
    }
  }, [arrival]);

  useEffect(() => {
    if (isAuthenticated) writeHopToken(null);
  }, [isAuthenticated]);

  useEffect(() => {
    if (isLoading || isAuthenticated || loopDetected) return;
    // Redirecting is a side effect: done during render it fires once per render
    // pass, and navigation is async so there is always more than one pass.
    if (hasRedirectedRef.current) return;
    hasRedirectedRef.current = true;

    if (bouncedBack) {
      writeHopToken(null);
      setLoopDetected(true);
      return;
    }
    goToSignIn();
  }, [isLoading, isAuthenticated, loopDetected, bouncedBack, goToSignIn]);

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
          onRetry={goToSignIn}
          onSignOut={() => {
            writeHopToken(null);
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
 * Shown as soon as a login flow hands the browser back without fixing the
 * session, instead of walking back into it.
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
              ? 'Your session is signed in but still needs two-factor verification, and the verification step sent you back here without completing. The console stopped rather than retry it in a loop.'
              : 'Sign-in sent you back here without establishing a session, so the console stopped rather than retry it in a loop.'}
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
