export const CREDENTIAL_AUTHORITY_PREFIX = 'credential:';
export const CREDENTIAL_PROJECTION_PREFIX = 'credential-projection:';
export const HOST_CAPABILITY_PREFIX = 'host-capability:';

export function credentialAuthorityControl(name: string): string {
  return `${CREDENTIAL_AUTHORITY_PREFIX}${name}`;
}

export function parseCredentialAuthorityControl(
  control: string,
): string | null {
  return control.startsWith(CREDENTIAL_AUTHORITY_PREFIX)
    ? control.slice(CREDENTIAL_AUTHORITY_PREFIX.length)
    : null;
}

export function credentialProjectionControl(projection: string): string {
  return `${CREDENTIAL_PROJECTION_PREFIX}${projection}`;
}

export function hostCapabilityControl(name: string): string {
  return `${HOST_CAPABILITY_PREFIX}${name}`;
}
