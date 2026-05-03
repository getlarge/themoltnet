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

/**
 * Base class for any failure to resolve a `PrincipalRow` into a
 * `PrincipalIdentity`. All subtypes carry the offending IDs so that
 * incidents can be triaged from the log without re-querying the DB.
 *
 * These errors indicate a corrupted invariant — never user input —
 * so callers should treat them as 5xx and surface the exact code +
 * context to observability.
 */
export abstract class PrincipalResolutionError extends Error {
  abstract readonly code:
    | 'PRINCIPAL_XOR_VIOLATED'
    | 'PRINCIPAL_MISSING'
    | 'PRINCIPAL_AGENT_JOIN_FAILED';

  constructor(
    message: string,
    public readonly context: {
      creatorAgentId: string | null;
      creatorHumanId: string | null;
    },
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * Both creator_agent_id and creator_human_id are set on the same row.
 * The DB-level `<table>_creator_xor` check should make this impossible;
 * if seen, the constraint was dropped or the JOIN duplicated rows.
 */
export class PrincipalXorViolatedError extends PrincipalResolutionError {
  readonly code = 'PRINCIPAL_XOR_VIOLATED';

  constructor(creatorAgentId: string, creatorHumanId: string) {
    super(
      `PrincipalRow XOR violated: both creator_agent_id (${creatorAgentId}) and creator_human_id (${creatorHumanId}) are set; the *_creator_xor check constraint may have been dropped`,
      { creatorAgentId, creatorHumanId },
    );
  }
}

/**
 * Neither creator_agent_id nor creator_human_id is set on the row.
 * Same source-of-truth as XOR violation: should be caught by the
 * DB check, but defended in code in case the constraint is removed.
 */
export class PrincipalMissingError extends PrincipalResolutionError {
  readonly code = 'PRINCIPAL_MISSING';

  constructor() {
    super(
      'PrincipalRow missing: neither creator_agent_id nor creator_human_id is set; the *_creator_xor check constraint may have been dropped or the row pre-dates the migration',
      { creatorAgentId: null, creatorHumanId: null },
    );
  }
}

/**
 * Row has creator_agent_id set, but the LEFT JOIN to `agents` did not
 * return fingerprint/publicKey. Means either: the FK target was deleted
 * (FK is `ON DELETE RESTRICT` so this should be impossible), or the
 * `.leftJoin(agents, …)` clause was omitted from the query.
 */
export class PrincipalAgentJoinFailedError extends PrincipalResolutionError {
  readonly code = 'PRINCIPAL_AGENT_JOIN_FAILED';

  constructor(
    creatorAgentId: string,
    public readonly missing: { fingerprint: boolean; publicKey: boolean },
  ) {
    const missingFields = [
      missing.fingerprint ? 'fingerprint' : null,
      missing.publicKey ? 'publicKey' : null,
    ]
      .filter(Boolean)
      .join(', ');
    super(
      `PrincipalRow agent variant for creator_agent_id=${creatorAgentId} is missing ${missingFields} — the LEFT JOIN to agents returned no match. Either the FK target was deleted (impossible under ON DELETE RESTRICT) or the .leftJoin(agents, …) clause was omitted from the query.`,
      { creatorAgentId, creatorHumanId: null },
    );
  }
}

export function resolvePrincipal(row: PrincipalRow): PrincipalIdentity {
  const hasAgent = row.creatorAgentId !== null;
  const hasHuman = row.creatorHumanId !== null;

  if (hasAgent && hasHuman) {
    throw new PrincipalXorViolatedError(
      row.creatorAgentId as string,
      row.creatorHumanId as string,
    );
  }
  if (!hasAgent && !hasHuman) {
    throw new PrincipalMissingError();
  }

  if (hasAgent) {
    if (!row.creatorAgentFingerprint || !row.creatorAgentPublicKey) {
      throw new PrincipalAgentJoinFailedError(row.creatorAgentId as string, {
        fingerprint: !row.creatorAgentFingerprint,
        publicKey: !row.creatorAgentPublicKey,
      });
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
