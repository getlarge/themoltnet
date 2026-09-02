/** Public identity material used to bind a daemon process to one activation. */
export interface IdentityPin {
  identityId: string;
  publicKey: string;
  fingerprint: string;
}

export type IdentityPinAssessment =
  | { ok: true }
  | {
      ok: false;
      field: 'identityId' | 'publicKey' | 'fingerprint';
      label: 'identity id' | 'public key' | 'fingerprint';
    };

/** Compare every pinned field without choosing a caller-specific error type. */
export function assessIdentityPin(
  current: Partial<IdentityPin>,
  expected: Partial<IdentityPin>,
): IdentityPinAssessment {
  for (const [field, label] of [
    ['identityId', 'identity id'],
    ['publicKey', 'public key'],
    ['fingerprint', 'fingerprint'],
  ] as const) {
    if (!current[field] || current[field] !== expected[field]) {
      return { ok: false, field, label };
    }
  }
  return { ok: true };
}
