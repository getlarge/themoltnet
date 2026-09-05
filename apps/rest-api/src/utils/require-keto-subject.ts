import { KetoNamespace, type SubjectType } from '@moltnet/auth';

import { createProblem } from '../problems/index.js';

export interface KetoSubject {
  /**
   * The Keto subject: `agents.id` or `humans.id`, never the Kratos identity.
   *
   * Named `subjectId` deliberately. It used to be `subjectId` because the two
   * were the same value; they are not any more, and a field that says
   * "identity" while carrying an internal id is exactly the ambiguity that let
   * the 2026-09-04 incident orphan the graph.
   */
  subjectId: string;
  subjectType: SubjectType;
  subjectNs: KetoNamespace;
}

interface AuthenticatedRequest {
  authContext?:
    | { subjectType: 'agent'; agentId: string }
    | { subjectType: 'human'; humanId: string }
    | null;
}

export function requireKetoSubject(request: AuthenticatedRequest): KetoSubject {
  const auth = request.authContext;
  if (!auth) {
    throw createProblem('unauthorized', 'Authentication context missing');
  }

  return {
    subjectId: auth.subjectType === 'human' ? auth.humanId : auth.agentId,
    subjectType: auth.subjectType,
    subjectNs:
      auth.subjectType === 'human' ? KetoNamespace.Human : KetoNamespace.Agent,
  };
}
