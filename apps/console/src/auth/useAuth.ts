/**
 * useAuth hook — convenience wrapper around AuthContext.
 *
 * Derives username and email from the Kratos identity traits.
 */

import { useContext } from 'react';

import { AuthContext, type AuthContextValue } from './AuthProvider.js';

export interface UseAuthResult extends AuthContextValue {
  username: string | null;
  email: string | null;
}

export function useAuth(): UseAuthResult {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  const traits = context.identity?.traits as
    | { username?: string; email?: string }
    | undefined;

  return {
    ...context,
    username: traits?.username ?? null,
    email: traits?.email ?? null,
  };
}
