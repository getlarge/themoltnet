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
 * - We translate the identity ID into the matching `humans.id` here
 *   (creating the row on first contact) so service / repo layers
 *   never have to know about the indirection.
 * - For agent principals, `agents.identity_id` IS the FK target,
 *   so no translation is needed.
 */

import type {
  AgentRepository,
  HumanRepository,
  PrincipalIdentity,
} from '@moltnet/database';
import {
  PrincipalMissingError,
  PrincipalXorViolatedError,
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
  authContext?: {
    identityId: string;
    subjectType: 'agent' | 'human';
  } | null;
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

/**
 * Thrown when `authContextToCreator` cannot translate the
 * authenticated principal into a `RepositoryCreator`. Carries
 * `code` and `identityId` so the global error handler can emit
 * a structured 5xx and observability tooling can aggregate.
 */
export class AuthContextResolutionError extends Error {
  readonly code = 'AUTH_CONTEXT_RESOLUTION_FAILED';
  constructor(
    message: string,
    public readonly identityId: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AuthContextResolutionError';
  }
}

export async function authContextToCreator(
  request: RequestWithAuthContext,
  humans: HumanRepository,
): Promise<RepositoryCreator> {
  const ctx = request.authContext;
  if (!ctx) {
    throw new Error(
      'authContextToCreator called on a request with no authContext (route is not behind requireAuth)',
    );
  }
  if (ctx.subjectType === 'agent') {
    return { kind: 'agent', id: ctx.identityId };
  }
  // Human: translate Kratos identityId -> humans.id (insert if missing).
  // Wrap the lookup so errors from the DB layer are observable: the
  // global handler sees a typed error with identityId in context, and
  // the request log carries the same fields for Axiom/OTel aggregation.
  try {
    const human = await humans.findOrCreateByIdentityId(ctx.identityId);
    return { kind: 'human', id: human.id };
  } catch (err) {
    request.log?.error(
      {
        err,
        identityId: ctx.identityId,
        subjectType: 'human',
        op: 'authContextToCreator.findOrCreateByIdentityId',
      },
      'authContextToCreator: failed to resolve human principal',
    );
    throw new AuthContextResolutionError(
      `Failed to resolve human principal for identityId=${ctx.identityId}`,
      ctx.identityId,
      err,
    );
  }
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
      throw new Error(
        `inflateCreator: agent ${creator.id} not found — race with agent deletion?`,
      );
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
    throw new Error(
      `inflateCreator: human ${creator.id} not found — race with human deletion?`,
    );
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
    let creator: PrincipalIdentity;
    if (row.creatorAgentId && row.creatorHumanId) {
      throw new PrincipalXorViolatedError(
        row.creatorAgentId,
        row.creatorHumanId,
      );
    }
    if (row.creatorAgentId) {
      const agent = agentMap.get(row.creatorAgentId);
      if (!agent) {
        throw new Error(
          `batchInflateRowsWithCreator: agent ${row.creatorAgentId} not found in batch lookup`,
        );
      }
      creator = {
        kind: 'agent',
        identityId: agent.identityId,
        fingerprint: agent.fingerprint,
        publicKey: agent.publicKey,
      };
    } else if (row.creatorHumanId) {
      const human = humanMap.get(row.creatorHumanId);
      if (!human) {
        throw new Error(
          `batchInflateRowsWithCreator: human ${row.creatorHumanId} not found in batch lookup`,
        );
      }
      creator = {
        kind: 'human',
        humanId: human.id,
        identityId: human.identityId,
      };
    } else {
      throw new PrincipalMissingError();
    }
    return { ...rest, creator };
  });
}
