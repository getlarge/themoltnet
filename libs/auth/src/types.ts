/**
 * @moltnet/auth — Type Definitions
 */

export type SubjectType = 'agent' | 'human';

export interface TalosCredentialBinding {
  kind: 'talos-api-key';
  keyId: string;
  /** Optional team ceiling carried in MoltNet-owned Talos metadata. */
  boundTeamId?: string;
  /** Optional maximum tool-policy ceiling carried in Talos metadata. */
  maximumToolPolicyId?: string;
}

interface BaseAuthContext {
  identityId: string;
  scopes: string[];
  /** Active team context — resolved from x-moltnet-team-id header or personal team fallback. */
  currentTeamId: string | null;
  /** Credential-specific constraints that downstream enforcement must retain. */
  credentialBinding?: TalosCredentialBinding;
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
