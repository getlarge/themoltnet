import { KetoNamespace } from './keto-constants.js';
import type { SubjectType } from './types.js';

/**
 * The authenticated principal, in the only form the rest of the system may key
 * on.
 *
 * `subjectId` is `agents.id` or `humans.id` — the Keto subject, the target of
 * every principal foreign key, and never the Kratos identity. Identities are
 * recreatable (2026-09-04), so a value that moves with one silently detaches a
 * principal from everything it owns.
 */
export interface AuthPrincipal {
  subjectId: string;
  subjectType: SubjectType;
  subjectNs: KetoNamespace;
}

/**
 * The minimum an auth context must carry to resolve a principal.
 *
 * Deliberately narrower than `AuthContext`, which satisfies it: callers at the
 * route boundary pass structural subsets to avoid dragging the FastifyRequest
 * generic through their signatures, and requiring the full context there
 * cascades type-inference failures into every typebox-registered handler.
 */
export type PrincipalSource =
  | { subjectType: 'agent'; agentId: string }
  | { subjectType: 'human'; humanId: string };

/**
 * Resolve an `AuthContext` to its internal principal.
 *
 * This mapping is load-bearing three times over — it decides the Keto subject
 * a permission check is made against, the value written to `creator_*_id`
 * columns, and the id compared for ownership — and it had been re-implemented
 * independently in the REST routes, the signing service and the creator
 * adapter. Drift between those copies does not fail loudly: each half is a
 * plausible UUID, so a divergence reappears as a permission that silently
 * matches nothing or a row attributed to the wrong principal.
 *
 * It lives here because `libs/auth` owns `AuthContext` and the namespace enum,
 * so this is the one place that cannot fall out of step with either. Call
 * sites adapt the result to their own shape (`{ kind, id }` for repository
 * creators, `{ subjectId, subjectNs }` for permission checks) rather than
 * re-deriving it.
 */
export function authPrincipal(authContext: PrincipalSource): AuthPrincipal {
  return authContext.subjectType === 'human'
    ? {
        subjectId: authContext.humanId,
        subjectType: 'human',
        subjectNs: KetoNamespace.Human,
      }
    : {
        subjectId: authContext.agentId,
        subjectType: 'agent',
        subjectNs: KetoNamespace.Agent,
      };
}

/**
 * The principal as a repository creator record, whose foreign keys target
 * `agents.id` / `humans.id`.
 */
export function authPrincipalCreator(authContext: PrincipalSource): {
  readonly kind: 'agent' | 'human';
  readonly id: string;
} {
  const { subjectType, subjectId } = authPrincipal(authContext);
  return { kind: subjectType, id: subjectId } as const;
}
