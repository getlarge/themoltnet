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

export interface AuthContextValue {
  session: Session | null;
  identity: Identity | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: Error | null;
  logout: () => Promise<void>;
  /** Re-check session (e.g. after login completes) */
  refreshSession: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Distinguishes a genuine "you are logged out" answer from a transient failure
 * (network blip, 5xx, CORS, aborted fetch).
 *
 * @ory/client-fetch throws ResponseError (carrying `.response`) for any non-2xx
 * response, and FetchError when fetch() itself rejected. Only 401 (no/invalid
 * session) and 403 (session_aal2_required) mean the user must re-authenticate.
 * Treating anything else as logged-out lets a momentary blip bounce the user to
 * login — see issue #1747.
 */
function isAuthenticationFailure(error: unknown): boolean {
  return (
    error instanceof ResponseError &&
    (error.response.status === 401 || error.response.status === 403)
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  // Guards against a slow in-flight response overwriting a newer one.
  const requestIdRef = useRef(0);
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

      const requestId = ++requestIdRef.current;
      const request = (async () => {
        try {
          const kratosClient = getKratosClient();
          const sess = await kratosClient.toSession();
          if (requestId !== requestIdRef.current) return;
          setSession(sess);
          setError(null);
        } catch (err) {
          if (requestId !== requestIdRef.current) return;
          if (isAuthenticationFailure(err)) {
            // Genuine sign-out: clear so AuthGuard redirects to login.
            setSession(null);
            setError(null);
          } else {
            // Transient: keep the session we already have. A background blip
            // must never unmount the app or bounce the user to login.
            setError(
              err instanceof Error ? err : new Error('Session check failed'),
            );
          }
        } finally {
          if (requestId === requestIdRef.current) {
            // isLoading means "have we resolved at least once". It never
            // returns to true, so background revalidation leaves the router
            // subtree mounted.
            setIsLoading(false);
          }
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
    logout,
    refreshSession: checkSession,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
