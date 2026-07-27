import { KetoNamespace, type SubjectType } from '@moltnet/auth';

import { createProblem } from '../problems/index.js';

export interface KetoSubject {
  identityId: string;
  subjectType: SubjectType;
  subjectNs: KetoNamespace;
}

interface AuthenticatedRequest {
  authContext?: {
    identityId: string;
    subjectType: SubjectType;
  } | null;
}

export function requireKetoSubject(request: AuthenticatedRequest): KetoSubject {
  const auth = request.authContext;
  if (!auth) {
    throw createProblem('unauthorized', 'Authentication context missing');
  }

  return {
    identityId: auth.identityId,
    subjectType: auth.subjectType,
    subjectNs:
      auth.subjectType === 'human' ? KetoNamespace.Human : KetoNamespace.Agent,
  };
}
