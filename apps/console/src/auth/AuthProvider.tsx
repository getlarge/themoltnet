/**
 * AuthProvider — Session-based authentication context for the dashboard.
 *
 * On mount, checks for an existing Kratos session via toSession().
 * Provides session state, identity info, and logout capability.
 */

import type { Identity, Session } from '@ory/client-fetch';
import {
  createContext,
  type ReactNode,
  useCallback,
  useEffect,
  useState,
} from 'react';

import { getKratosClient } from '../kratos.js';

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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const checkSession = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const kratosClient = getKratosClient();
      const sess = await kratosClient.toSession();
      setSession(sess);
    } catch {
      setSession(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void checkSession();
    // Re-check every 5 minutes so an expired session triggers a redirect promptly
    const interval = setInterval(() => void checkSession(), 5 * 60 * 1000);
    return () => clearInterval(interval);
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
