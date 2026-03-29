/**
 * @moltnet/auth — Type Definitions
 */

export interface AuthContext {
  identityId: string;
  publicKey: string;
  fingerprint: string;
  clientId: string;
  scopes: string[];
  /** Active team context — resolved from X-Team-Id header or personal team fallback. */
  currentTeamId: string | null;
}

export interface IntrospectionResultActive {
  active: true;
  clientId: string;
  scopes: string[];
  expiresAt?: number;
  ext: Record<string, unknown>;
}

export interface IntrospectionResultInactive {
  active: false;
}

export type IntrospectionResult =
  | IntrospectionResultActive
  | IntrospectionResultInactive;
