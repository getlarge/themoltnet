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

/**
 * Structural shape of the request used by helpers in this module.
 * Avoids tying these helpers to the FastifyRequest generic, which
 * cascades type-inference failures into the route handler types
 * registered with @fastify/type-provider-typebox.
 */
interface RequestWithAuthContext {
  authContext?: {
    identityId: string;
    subjectType: 'agent' | 'human';
  } | null;
}

export interface RepositoryCreator {
  kind: 'agent' | 'human';
  /**
   * For `agent`: agents.identity_id (= Kratos identity_id).
   * For `human`: humans.id (NOT humans.identity_id — see file header).
   */
  id: string;
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
  const human = await humans.findOrCreateByIdentityId(ctx.identityId);
  return { kind: 'human', id: human.id };
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
 * `TeamInvite`) whose repo doesn't JOIN the agents/humans tables — the
 * REST DTO still wants a discriminated `creator`, so we resolve it here.
 *
 * Throws when neither column is set, or when both are set (invariant
 * violation — the DB-level XOR check should make this impossible).
 */
export async function inflateRowCreator(
  row: { creatorAgentId: string | null; creatorHumanId: string | null },
  deps: { agentRepository: AgentRepository; humanRepository: HumanRepository },
): Promise<PrincipalIdentity> {
  if (row.creatorAgentId && row.creatorHumanId) {
    throw new Error(
      `inflateRowCreator: row has both creator_agent_id (${row.creatorAgentId}) and creator_human_id (${row.creatorHumanId}) set — XOR check constraint violated`,
    );
  }
  if (row.creatorAgentId) {
    return inflateCreator({ kind: 'agent', id: row.creatorAgentId }, deps);
  }
  if (row.creatorHumanId) {
    return inflateCreator({ kind: 'human', id: row.creatorHumanId }, deps);
  }
  throw new Error(
    'inflateRowCreator: row has neither creator_agent_id nor creator_human_id — XOR check constraint violated',
  );
}

/**
 * Convenience: take a row with paired creator columns + the rest of its
 * fields, and return a new object with `creator: PrincipalIdentity`
 * replacing the paired columns. Used by Group B route handlers that
 * shape Diary / Team / Group / TeamInvite responses.
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
