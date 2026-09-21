/**
 * AuthProvider — Session-based authentication context for the dashboard.
 *
 * On mount, checks for an existing Kratos session via toSession().
 * Provides session state, identity info, and logout capability.
 */

import type { Identity, Session } from '@ory/client-fetch';
import { ResponseError } from '@ory/client-fetch';
import {
  createContext,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import { getKratosClient } from '../kratos.js';

const FOREGROUND_REVALIDATION_INTERVAL_MS = 30_000;
const SESSION_CHECK_TIMEOUT_MS = 10_000;

async function toSessionWithTimeout(): Promise<Session> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error('Session check timed out'));
      controller.abort();
    }, SESSION_CHECK_TIMEOUT_MS);
  });

  try {
    return await Promise.race([
      getKratosClient().toSession({}, { signal: controller.signal }),
      timeout,
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

/**
 * Why the session is unusable, when it is.
 *
 * - `none` — either authenticated, or we have not resolved yet.
 * - `unauthenticated` — Kratos has no session for this browser (401).
 * - `second_factor_required` — Kratos *has* a session, but it does not meet
 *   the required Authenticator Assurance Level (403). The distinction matters:
 *   these two need different login flows. See `challengeRedirectTo`.
 */
export type AuthChallenge =
  | 'none'
  | 'unauthenticated'
  | 'second_factor_required';

export interface AuthContextValue {
  session: Session | null;
  identity: Identity | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: Error | null;
  /** Why the session is unusable — drives which login flow AuthGuard opens. */
  challenge: AuthChallenge;
  /**
   * The `redirect_browser_to` Kratos returns alongside a 403. It already points
   * at the flow that satisfies the missing factor (e.g. `…/self-service/login/
   * browser?aal=aal2`), so preferring it over a hand-built URL keeps us correct
   * if Ory ever changes which factor it asks for.
   */
  challengeRedirectTo: string | null;
  logout: () => Promise<void>;
  /** Re-check session (e.g. after login completes) */
  refreshSession: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

interface OryErrorBody {
  error?: { id?: string };
  redirect_browser_to?: string;
}

/**
 * Reads Kratos' JSON error envelope without disturbing the caller's response.
 *
 * `.clone()` because @ory/client-fetch hands us an unread body; consuming the
 * original would break any other reader.
 */
async function readOryErrorBody(
  response: Response,
): Promise<OryErrorBody | null> {
  try {
    return (await response.clone().json()) as OryErrorBody;
  } catch {
    return null;
  }
}

type SessionFailure =
  /** Network blip, 5xx, CORS, aborted fetch — keep whatever session we have. */
  | { kind: 'transient' }
  | { kind: 'unauthenticated' }
  | { kind: 'second_factor_required'; redirectTo: string | null };

/**
 * Classifies a failed `toSession()` call.
 *
 * @ory/client-fetch throws ResponseError (carrying `.response`) for any non-2xx
 * response, and FetchError when fetch() itself rejected. Only 401 and 403 mean
 * the user must re-authenticate; treating anything else as logged-out lets a
 * momentary blip bounce the user to login — see issue #1747.
 *
 * 401 and 403 are *not* interchangeable. A 403 from `/sessions/whoami` is
 * always an AAL error: the cookie is valid, but the session sits at aal1 while
 * the identity has a second factor enrolled. Sending that user to a plain
 * (aal1) login flow makes Kratos answer "you are already logged in" and 302
 * straight back to `return_to` — console redirects to Kratos, Kratos redirects
 * to console, forever. That is the loop this guard exists to prevent.
 */
async function classifySessionFailure(error: unknown): Promise<SessionFailure> {
  if (!(error instanceof ResponseError)) return { kind: 'transient' };

  const { status } = error.response;
  if (status === 401) return { kind: 'unauthenticated' };
  if (status !== 403) return { kind: 'transient' };

  const body = await readOryErrorBody(error.response);
  return {
    kind: 'second_factor_required',
    redirectTo: body?.redirect_browser_to ?? null,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [challenge, setChallenge] = useState<AuthChallenge>('none');
  const [challengeRedirectTo, setChallengeRedirectTo] = useState<string | null>(
    null,
  );
  const inFlightCheckRef = useRef<Promise<void> | null>(null);
  const lastForegroundAttemptAtRef = useRef(Number.NEGATIVE_INFINITY);

  const checkSession = useCallback(
    (options: { throttleForeground?: boolean } = {}): Promise<void> => {
      if (options.throttleForeground) {
        const now = Date.now();
        if (
          now - lastForegroundAttemptAtRef.current <
          FOREGROUND_REVALIDATION_INTERVAL_MS
        ) {
          return Promise.resolve();
        }
        // Throttle attempts, not only successes, so a transient Ory failure
        // cannot turn repeated focus events into a request storm.
        lastForegroundAttemptAtRef.current = now;
      }

      if (inFlightCheckRef.current) return inFlightCheckRef.current;

      const request = (async () => {
        try {
          const sess = await toSessionWithTimeout();
          setSession(sess);
          setError(null);
          setChallenge('none');
          setChallengeRedirectTo(null);
        } catch (err) {
          const failure = await classifySessionFailure(err);
          if (failure.kind === 'transient') {
            // Keep the session we already have. A background blip must never
            // unmount the app or bounce the user to login.
            setError(
              err instanceof Error ? err : new Error('Session check failed'),
            );
          } else {
            // Genuine sign-out, or a session that needs a second factor:
            // clear so AuthGuard redirects to the right login flow.
            setSession(null);
            setError(null);
            setChallenge(failure.kind);
            setChallengeRedirectTo(
              failure.kind === 'second_factor_required'
                ? failure.redirectTo
                : null,
            );
          }
        } finally {
          // isLoading means "have we resolved at least once". It never
          // returns to true, so background revalidation leaves the router
          // subtree mounted.
          setIsLoading(false);
        }
      })();

      inFlightCheckRef.current = request;
      void request.finally(() => {
        if (inFlightCheckRef.current === request) {
          inFlightCheckRef.current = null;
        }
      });
      return request;
    },
    [],
  );

  useEffect(() => {
    void checkSession();
  }, [checkSession]);

  // Revalidate when the user returns to the tab rather than on a blind timer.
  // This still catches an expired session at the moment the user interacts,
  // without polling a backgrounded tab (~96 requests overnight, each an extra
  // chance to trip a transient failure).
  useEffect(() => {
    const revalidate = () => {
      if (document.visibilityState === 'visible') {
        void checkSession({ throttleForeground: true });
      }
    };
    document.addEventListener('visibilitychange', revalidate);
    window.addEventListener('focus', revalidate);
    return () => {
      document.removeEventListener('visibilitychange', revalidate);
      window.removeEventListener('focus', revalidate);
    };
  }, [checkSession]);

  const logout = useCallback(async () => {
    try {
      const kratosClient = getKratosClient();
      const logoutFlow = await kratosClient.createBrowserLogoutFlow();
      // Redirect browser to Ory logout URL — avoids cross-origin POST CORS issues
      window.location.assign(logoutFlow.logout_url);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Logout failed'));
    }
  }, []);

  const value: AuthContextValue = {
    session,
    identity: session?.identity ?? null,
    isAuthenticated: !!session?.active,
    isLoading,
    error,
    challenge,
    challengeRedirectTo,
    logout,
    refreshSession: checkSession,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
