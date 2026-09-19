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
