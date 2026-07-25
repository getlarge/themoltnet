export type SigningCredentialErrorCode =
  | 'credential_private_material_rejected'
  | 'credential_registration_invalid'
  | 'credential_inactive'
  | 'credential_method_mismatch'
  | 'credential_lifecycle_conflict'
  | 'signer_constraint_unsupported'
  | 'signing_request_claim_conflict'
  | 'signing_request_receipt_invalid';

export class SigningCredentialError extends Error {
  constructor(
    public readonly code: SigningCredentialErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SigningCredentialError';
  }
}

const PRIVATE_FIELD_NAMES = new Set([
  'private',
  'privatekey',
  'privatematerial',
  'secret',
  'secretkey',
  'seed',
]);

function normalizedFieldName(name: string): string {
  return name.toLowerCase().replaceAll(/[^a-z]/g, '');
}

/**
 * Refuse private signing material at the domain boundary. The database only
 * accepts the value after this recursive inspection, so nested JSON cannot
 * evade the public API contract.
 */
export function assertNoPrivateSigningMaterial(
  value: unknown,
  path = 'publicMaterial',
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertNoPrivateSigningMaterial(item, `${path}[${index}]`),
    );
    return;
  }
  if (!value || typeof value !== 'object') return;

  for (const [key, nested] of Object.entries(value)) {
    if (PRIVATE_FIELD_NAMES.has(normalizedFieldName(key))) {
      throw new SigningCredentialError(
        'credential_private_material_rejected',
        `Private signing material is not accepted (${path}.${key})`,
      );
    }
    assertNoPrivateSigningMaterial(nested, `${path}.${key}`);
  }
}

export function assertSupportedSignerConstraint(type: string): void {
  if (type === 'site' || type === 'station') {
    throw new SigningCredentialError(
      'signer_constraint_unsupported',
      `Signer constraint ${type} is not supported in this phase`,
    );
  }
}
