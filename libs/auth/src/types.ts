/**
 * @moltnet/auth — Type Definitions
 */

export type SubjectType = 'agent' | 'human';

interface BaseAuthContext {
  identityId: string;
  scopes: string[];
  /** Active team context — resolved from x-moltnet-team-id header or personal team fallback. */
  currentTeamId: string | null;
}

export interface AgentAuthContext extends BaseAuthContext {
  /** Subject type — determines Keto namespace for permission checks. */
  subjectType: 'agent';
  publicKey: string;
  fingerprint: string;
  clientId: string;
}

export interface HumanAuthContext extends BaseAuthContext {
  /** Subject type — determines Keto namespace for permission checks. */
  subjectType: 'human';
  /** Null when authenticated via direct Kratos session (no OAuth2 client). */
  clientId: string | null;
  /**
   * Internal `humans.id` for this principal — set by the
   * after-registration webhook (Kratos `metadata_public.human_id`) and
   * read here. Always present for an authenticated human; required by
   * resource-creating routes whose paired-FK columns target `humans.id`,
   * not the Kratos identityId.
   */
  humanId: string;
}

export type AuthContext = AgentAuthContext | HumanAuthContext;

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
