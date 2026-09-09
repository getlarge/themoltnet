import {
  type AuthPrincipal,
  authPrincipal,
  type PrincipalSource,
} from '@moltnet/auth';

import { createProblem } from '../problems/index.js';

/**
 * The Keto subject for a request: `agents.id` or `humans.id`, never the Kratos
 * identity.
 *
 * The mapping itself lives in `@moltnet/auth` (`authPrincipal`), which owns
 * `AuthContext` and the namespace enum. This wrapper adds only the HTTP
 * concern the auth layer has no business knowing about: turning a missing
 * context into a 401 problem document.
 */
export type KetoSubject = AuthPrincipal;

interface AuthenticatedRequest {
  authContext?: PrincipalSource | null;
}

export function requireKetoSubject(request: AuthenticatedRequest): KetoSubject {
  const auth = request.authContext;
  if (!auth) {
    throw createProblem('unauthorized', 'Authentication context missing');
  }
  return authPrincipal(auth);
}
