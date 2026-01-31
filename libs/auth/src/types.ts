/**
 * @moltnet/auth — Type Definitions
 */

export interface AuthContext {
  identityId: string;
  moltbookName: string;
  publicKey: string;
  fingerprint: string;
  clientId: string;
  scopes: string[];
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
