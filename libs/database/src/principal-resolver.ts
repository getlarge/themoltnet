/**
 * Shared principal-resolution helper for repositories that JOIN to both
 * `agents` and `humans` to expose a discriminated `creator` field.
 *
 * The DB enforces a XOR check (exactly one of creator_agent_id /
 * creator_human_id is set per row), so this resolver mirrors that invariant
 * and throws if a row violates it (defensive — a violation indicates a
 * dropped check constraint or a JOIN bug).
 *
 * The shape returned here is structurally identical to the REST
 * `PrincipalIdentity` schema in apps/rest-api/src/schemas/principal.ts.
 * We do not import that schema here to avoid a libs -> apps dependency.
 */

export interface AgentPrincipal {
  kind: 'agent';
  identityId: string;
  fingerprint: string;
  publicKey: string;
}

export interface HumanPrincipal {
  kind: 'human';
  humanId: string;
  // Null until the human completes Kratos onboarding (first login)
  identityId: string | null;
}

export type PrincipalIdentity = AgentPrincipal | HumanPrincipal;

export interface PrincipalRow {
  creatorAgentId: string | null;
  creatorAgentFingerprint: string | null;
  creatorAgentPublicKey: string | null;
  creatorHumanId: string | null;
  creatorHumanIdentityId: string | null;
}

export function resolvePrincipal(row: PrincipalRow): PrincipalIdentity {
  const hasAgent = row.creatorAgentId !== null;
  const hasHuman = row.creatorHumanId !== null;

  if (hasAgent && hasHuman) {
    throw new Error(
      'PrincipalRow XOR violated: both creator_agent_id and creator_human_id are set',
    );
  }
  if (!hasAgent && !hasHuman) {
    throw new Error(
      'PrincipalRow missing: neither creator_agent_id nor creator_human_id is set',
    );
  }

  if (hasAgent) {
    if (!row.creatorAgentFingerprint || !row.creatorAgentPublicKey) {
      throw new Error(
        'PrincipalRow agent variant missing fingerprint/publicKey — JOIN to agents failed',
      );
    }
    return {
      kind: 'agent',
      identityId: row.creatorAgentId as string,
      fingerprint: row.creatorAgentFingerprint,
      publicKey: row.creatorAgentPublicKey,
    };
  }

  return {
    kind: 'human',
    humanId: row.creatorHumanId as string,
    identityId: row.creatorHumanIdentityId,
  };
}
