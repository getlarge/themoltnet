import { createClient, joinTeam } from '@moltnet/api-client';
import { buildTeamEnrollmentMessage } from '@moltnet/models';

import {
  normalizeOptionalApiUrl,
  requireSecureCredentialApiUrl,
} from './api-url.js';

export interface EnrollmentSigner {
  sign(message: string): Promise<string>;
}

/** Contains no server detail, signature, invitation or credential material. */
export class EnrollmentRequestError extends Error {
  constructor(
    readonly statusCode?: number,
    readonly issuedKeyId?: string,
  ) {
    super(
      issuedKeyId
        ? 'Enrollment already issued a credential; use a fresh invitation if its secret was not captured'
        : 'Enrollment did not return a credential',
    );
  }
}

export async function requestProofEnrollment(input: {
  signer: EnrollmentSigner;
  subjectId: string;
  code: string;
  idempotencyKey: string;
  expectedTeamId?: string;
  apiUrl?: string;
}) {
  const client = createClient({
    baseUrl: requireSecureCredentialApiUrl(
      normalizeOptionalApiUrl(input.apiUrl),
    ),
  });
  const proof = await input.signer.sign(buildTeamEnrollmentMessage(input));
  const response = await joinTeam({
    client,
    headers: { 'idempotency-key': input.idempotencyKey },
    body: {
      code: input.code,
      issueAgentKey: true,
      proof: { subjectId: input.subjectId, signature: proof },
      expectedTeamId: input.expectedTeamId,
    },
  });
  if (!response.data) {
    const error = response.error as
      | {
          conflict?: {
            target?: { resource?: string; keys?: { keyId?: unknown } };
          };
        }
      | undefined;
    const target = error?.conflict?.target;
    const keyId =
      target?.resource === 'agent-key' && typeof target.keys?.keyId === 'string'
        ? target.keys.keyId
        : undefined;
    throw new EnrollmentRequestError(response.response.status, keyId);
  }
  return response.data;
}
