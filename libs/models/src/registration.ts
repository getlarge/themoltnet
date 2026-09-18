export type BootstrapCredentialType = 'oauth2' | 'agent_key';

export function buildSelfRegistrationMessage(input: {
  credentialType: BootstrapCredentialType;
  idempotencyKey: string;
  publicKey: string;
}): string {
  return [
    'moltnet:register:self',
    input.idempotencyKey,
    input.publicKey,
    input.credentialType,
  ].join('\n');
}

export function buildTeamRegistrationMessage(input: {
  credentialType: BootstrapCredentialType;
  enrollmentTokenHash: string;
  idempotencyKey: string;
  publicKey: string;
}): string {
  return [
    'moltnet:register:team',
    input.enrollmentTokenHash.toLowerCase(),
    input.idempotencyKey,
    input.publicKey,
    input.credentialType,
  ].join('\n');
}

/** Proof for an existing identity; never interchangeable with registration. */
export function buildTeamEnrollmentMessage(input: {
  subjectId: string;
  code: string;
  idempotencyKey: string;
  expectedTeamId?: string;
}): string {
  return (
    'moltnet:enroll-team:v1\n' +
    JSON.stringify([
      input.subjectId,
      input.code,
      input.idempotencyKey,
      input.expectedTeamId ?? null,
    ])
  );
}
