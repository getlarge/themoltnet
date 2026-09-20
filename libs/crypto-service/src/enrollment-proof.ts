import { createHash } from 'node:crypto';

/** Domain-separated identity proof for one human-approved enrollment token. */
export function enrollmentProofMessage(input: {
  accessToken: string;
  grant: {
    agentId: string;
    teamId: string;
    operation: 'enroll' | 'renew';
    scopes: string[];
    idempotencyKey: string;
  };
}): string {
  const { grant } = input;
  return JSON.stringify([
    'moltnet:pkce-team-enrollment:v1',
    createHash('sha256').update(input.accessToken).digest('hex'),
    grant.agentId,
    grant.teamId,
    grant.operation,
    [...new Set(grant.scopes)].sort(),
    grant.idempotencyKey,
  ]);
}
