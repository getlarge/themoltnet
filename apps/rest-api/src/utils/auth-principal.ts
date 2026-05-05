/**
 * Resolve a Fastify request's auth context into the discriminated
 * principal used by repositories and services for write operations.
 *
 * Why this lives at the route boundary:
 * - `humans.id` and `humans.identity_id` are different UUIDs.
 *   Resource tables (`diaries`, `diary_entries`, `context_packs`,
 *   `rendered_packs`, `teams`, `groups`, `team_invites`) FK
 *   `creator_human_id` against `humans.id`, NOT against the Kratos
 *   identity ID that lives on `request.authContext.identityId`.
 * - `humans.id` is sourced from the Kratos identity's
 *   `metadata_public.human_id` (set by the after-registration webhook
 *   BEFORE any session/token can exist) and surfaced in the
 *   `HumanAuthContext.humanId` field by the auth layer. We read it
 *   directly here instead of doing a DB lookup keyed by identityId —
 *   that lookup would race the human-onboarding DBOS workflow's
 *   `setIdentityIdStep` and trigger duplicate-row INSERTs.
 * - For agent principals, `agents.identity_id` IS the FK target,
 *   so no translation is needed.
 */

import type {
  AgentRepository,
  HumanRepository,
  PrincipalIdentity,
} from '@moltnet/database';
import {
  PrincipalAgentNotFoundError,
  PrincipalHumanNotFoundError,
  PrincipalMissingError,
  PrincipalXorViolatedError,
  resolvePrincipal,
} from '@moltnet/database';

/**
 * Structural shape of the request used by helpers in this module.
 * Avoids tying these helpers to the FastifyRequest generic, which
 * cascades type-inference failures into the route handler types
 * registered with @fastify/type-provider-typebox.
 *
 * The `log` field is the request-scoped Pino logger; we use it to
 * emit structured context before re-throwing repository errors so
 * observability tooling can correlate failures with identityId.
 */
interface RequestWithAuthContext {
  authContext?:
    | {
        identityId: string;
        subjectType: 'agent';
      }
    | {
        identityId: string;
        subjectType: 'human';
        humanId: string;
      }
    | null;
  log?: {
    error(obj: object, msg: string): void;
  };
}

export interface RepositoryCreator {
  kind: 'agent' | 'human';
  /**
   * For `agent`: agents.identity_id (= Kratos identity_id).
   * For `human`: humans.id (NOT humans.identity_id — see file header).
   */
  id: string;
}

export function authContextToCreator(
  request: RequestWithAuthContext,
): RepositoryCreator {
  const ctx = request.authContext;
  if (!ctx) {
    throw new Error(
      'authContextToCreator called on a request with no authContext (route is not behind requireAuth)',
    );
  }
  if (ctx.subjectType === 'agent') {
    return { kind: 'agent', id: ctx.identityId };
  }
  // Human: humans.id is on the auth context (sourced from Kratos
  // metadata_public.human_id). No DB lookup, no race with onboarding.
  return { kind: 'human', id: ctx.humanId };
}

/**
 * Inflate a `RepositoryCreator { kind, id }` (compact write-side shape)
 * into the full `PrincipalIdentity` discriminated union returned by
 * REST responses. Looks up agent fingerprint+publicKey or human identityId
 * as needed.
 *
 * Use this in route handlers that write a resource and need to echo the
 * creator back in the response body (e.g. `POST /diaries`, `POST /packs`)
 * — the repository's create() returns the raw row without the JOIN, so
 * the route inflates from the just-resolved creator instead of issuing a
 * second SELECT.
 */
export async function inflateCreator(
  creator: RepositoryCreator,
  deps: { agentRepository: AgentRepository; humanRepository: HumanRepository },
): Promise<PrincipalIdentity> {
  if (creator.kind === 'agent') {
    const agent = await deps.agentRepository.findByIdentityId(creator.id);
    if (!agent) {
      throw new PrincipalAgentNotFoundError(creator.id);
    }
    return {
      kind: 'agent',
      identityId: agent.identityId,
      fingerprint: agent.fingerprint,
      publicKey: agent.publicKey,
    };
  }
  const human = await deps.humanRepository.findById(creator.id);
  if (!human) {
    throw new PrincipalHumanNotFoundError(creator.id);
  }
  return {
    kind: 'human',
    humanId: human.id,
    identityId: human.identityId,
  };
}

/**
 * Inflate a row that has paired creator FK columns
 * (`creator_agent_id` / `creator_human_id`) into a `PrincipalIdentity`.
 *
 * Use this when reading a Group B resource (`Diary`, `Team`, `Group`,
 * `TeamInvite`) whose repo doesn't JOIN the agents/humans tables. Note
 * this issues a per-row lookup against agents/humans — for list paths
 * with many rows, consider switching the repository to JOIN both tables
 * and call `resolvePrincipal` directly on the JOIN columns instead
 * (see context-pack.repository.ts for the canonical pattern).
 *
 * XOR-violation and missing-creator cases throw typed errors from
 * `@moltnet/database` so the global error handler and observability
 * tooling can match on `code`.
 */
export async function inflateRowCreator(
  row: { creatorAgentId: string | null; creatorHumanId: string | null },
  deps: { agentRepository: AgentRepository; humanRepository: HumanRepository },
): Promise<PrincipalIdentity> {
  if (row.creatorAgentId && row.creatorHumanId) {
    throw new PrincipalXorViolatedError(row.creatorAgentId, row.creatorHumanId);
  }
  if (row.creatorAgentId) {
    return inflateCreator({ kind: 'agent', id: row.creatorAgentId }, deps);
  }
  if (row.creatorHumanId) {
    return inflateCreator({ kind: 'human', id: row.creatorHumanId }, deps);
  }
  throw new PrincipalMissingError();
}

/**
 * Convenience: take a row with paired creator columns + the rest of its
 * fields, and return a new object with `creator: PrincipalIdentity`
 * replacing the paired columns. Used by Group B route handlers that
 * shape Diary / Team / Group / TeamInvite responses.
 *
 * Same N+1 caveat as `inflateRowCreator`: prefer JOIN-based resolution
 * in the repository when called over a list of rows.
 */
export async function rowToResponseWithCreator<
  T extends { creatorAgentId: string | null; creatorHumanId: string | null },
>(
  row: T,
  deps: { agentRepository: AgentRepository; humanRepository: HumanRepository },
): Promise<
  Omit<T, 'creatorAgentId' | 'creatorHumanId'> & { creator: PrincipalIdentity }
> {
  const { creatorAgentId: _a, creatorHumanId: _h, ...rest } = row;
  return {
    ...rest,
    creator: await inflateRowCreator(row, deps),
  };
}

/**
 * Build a `PrincipalIdentity` from a row that already includes the
 * fully-resolved creator columns (typically because the repository
 * LEFT JOINed agents + humans in the same query). Avoids the N+1
 * pattern of `inflateRowCreator`.
 *
 * This is a thin re-export of `resolvePrincipal` for routes that don't
 * want to depend on `@moltnet/database` directly.
 */
export { resolvePrincipal } from '@moltnet/database';

/**
 * Batch variant of `rowToResponseWithCreator` for list endpoints.
 *
 * Issues exactly two queries (one to `agents`, one to `humans`) for the
 * full set of rows, then maps each row's creator from the in-memory
 * lookup. Eliminates the N+1 problem of calling
 * `rowToResponseWithCreator(row, deps)` per row.
 *
 * Use this in any route that returns a list of resources whose
 * repository does not already JOIN the agents/humans tables. (For
 * repositories that DO JOIN — like `context-pack.repository.ts` —
 * call `resolvePrincipal` directly on the JOIN columns instead.)
 */
export async function batchInflateRowsWithCreator<
  T extends { creatorAgentId: string | null; creatorHumanId: string | null },
>(
  rows: readonly T[],
  deps: { agentRepository: AgentRepository; humanRepository: HumanRepository },
): Promise<
  Array<
    Omit<T, 'creatorAgentId' | 'creatorHumanId'> & {
      creator: PrincipalIdentity;
    }
  >
> {
  if (rows.length === 0) return [];
  const agentIds = rows
    .map((r) => r.creatorAgentId)
    .filter((id): id is string => id !== null);
  const humanIds = rows
    .map((r) => r.creatorHumanId)
    .filter((id): id is string => id !== null);
  const [agentMap, humanMap] = await Promise.all([
    deps.agentRepository.findByIdentityIds(agentIds),
    deps.humanRepository.findByIds(humanIds),
  ]);

  return rows.map((row) => {
    const { creatorAgentId: _a, creatorHumanId: _h, ...rest } = row;

    // Project the in-memory batch lookup into the JOIN-shaped row that
    // resolvePrincipal expects. Reusing resolvePrincipal here keeps a
    // single source of truth for XOR / missing / join-failed handling
    // and the typed PrincipalResolutionError hierarchy — anything else
    // is a re-implementation that drifts.
    const agent = row.creatorAgentId
      ? (agentMap.get(row.creatorAgentId) ?? null)
      : null;
    if (row.creatorAgentId && !agent) {
      // Lookup miss against the batched agents query — agents row was
      // deleted under us (impossible under FK ON DELETE RESTRICT, so
      // this == data corruption, not user input).
      throw new PrincipalAgentNotFoundError(row.creatorAgentId);
    }
    const human = row.creatorHumanId
      ? (humanMap.get(row.creatorHumanId) ?? null)
      : null;
    if (row.creatorHumanId && !human) {
      throw new PrincipalHumanNotFoundError(row.creatorHumanId);
    }

    const creator = resolvePrincipal({
      creatorAgentId: row.creatorAgentId,
      creatorAgentFingerprint: agent?.fingerprint ?? null,
      creatorAgentPublicKey: agent?.publicKey ?? null,
      creatorHumanId: row.creatorHumanId,
      creatorHumanIdentityId: human?.identityId ?? null,
    });
    return { ...rest, creator };
  });
}
