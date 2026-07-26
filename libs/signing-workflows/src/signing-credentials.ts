import { createPrivateKey } from 'node:crypto';

export type SigningCredentialErrorCode =
  | 'credential_private_material_rejected'
  | 'credential_public_material_invalid'
  | 'credential_registration_invalid'
  | 'credential_inactive'
  | 'credential_method_mismatch'
  | 'credential_lifecycle_conflict'
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
  'd',
  'dp',
  'dq',
  'keymaterial',
  'p',
  'private',
  'privatekey',
  'privatematerial',
  'priv',
  'q',
  'qi',
  'secret',
  'secretkey',
  'seed',
  'sk',
]);

const PRIVATE_VALUE_PATTERN =
  /-----BEGIN (?:ENCRYPTED )?(?:EC |RSA |OPENSSH )?PRIVATE KEY-----/i;
const ENCODED_KEY_PATTERN = /^[A-Za-z0-9+/_=-]+$/;
const HEX_KEY_PATTERN = /^[0-9a-f]+$/i;
const MAX_MATERIAL_DEPTH = 16;
const MAX_MATERIAL_NODES = 1000;

function normalizedFieldName(name: string): string {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replaceAll(/[^a-z]/g, '');
}

function containsPrivateKeyValue(value: string): boolean {
  if (PRIVATE_VALUE_PATTERN.test(value)) return true;
  const compact = value.replaceAll(/\s/g, '');
  let key: Buffer;
  if (
    compact.length >= 64 &&
    compact.length % 2 === 0 &&
    HEX_KEY_PATTERN.test(compact)
  ) {
    key = Buffer.from(compact, 'hex');
  } else if (compact.length >= 32 && ENCODED_KEY_PATTERN.test(compact)) {
    const base64 = compact
      .replaceAll('-', '+')
      .replaceAll('_', '/')
      .padEnd(Math.ceil(compact.length / 4) * 4, '=');
    key = Buffer.from(base64, 'base64');
  } else {
    return false;
  }
  // PKCS#8, PKCS#1, and SEC1 private keys are DER SEQUENCE values.
  if (key[0] !== 0x30) return false;
  for (const type of ['pkcs8', 'pkcs1', 'sec1'] as const) {
    try {
      createPrivateKey({ key, format: 'der', type });
      return true;
    } catch {
      // Try the next standard private-key container.
    }
  }
  return false;
}

/**
 * Refuse private signing material at the domain boundary. The database only
 * accepts the value after this recursive inspection, so nested JSON cannot
 * evade the public API contract.
 */
export function assertNoPrivateSigningMaterial(
  value: unknown,
  rootPath = 'publicMaterial',
): void {
  const pending: Array<{
    value: unknown;
    depth: number;
    path: Array<string | number>;
  }> = [{ value, depth: 0, path: [] }];
  let visited = 0;

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) break;
    visited += 1;
    if (current.depth > MAX_MATERIAL_DEPTH || visited > MAX_MATERIAL_NODES) {
      throw new SigningCredentialError(
        'credential_public_material_invalid',
        'Signing material exceeds the allowed JSON depth or node count',
      );
    }
    if (
      typeof current.value === 'string' &&
      containsPrivateKeyValue(current.value)
    ) {
      throw new SigningCredentialError(
        'credential_private_material_rejected',
        `Private signing material is not accepted (${formatPath(rootPath, current.path)})`,
      );
    }
    if (Array.isArray(current.value)) {
      if (
        (current.value.length === 32 || current.value.length === 64) &&
        current.value.every(
          (item) => Number.isInteger(item) && item >= 0 && item <= 255,
        )
      ) {
        throw new SigningCredentialError(
          'credential_private_material_rejected',
          `Raw key bytes are not accepted (${formatPath(rootPath, current.path)})`,
        );
      }
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        pending.push({
          value: current.value[index],
          depth: current.depth + 1,
          path: [...current.path, index],
        });
      }
      continue;
    }
    if (!current.value || typeof current.value !== 'object') continue;

    for (const [key, nested] of Object.entries(current.value)) {
      if (!/^[\x20-\x7e]+$/.test(key)) {
        throw new SigningCredentialError(
          'credential_public_material_invalid',
          `Signing material field names must be ASCII (${formatPath(rootPath, [...current.path, key])})`,
        );
      }
      if (PRIVATE_FIELD_NAMES.has(normalizedFieldName(key))) {
        throw new SigningCredentialError(
          'credential_private_material_rejected',
          `Private signing material is not accepted (${formatPath(rootPath, [...current.path, key])})`,
        );
      }
      pending.push({
        value: nested,
        depth: current.depth + 1,
        path: [...current.path, key],
      });
    }
  }
}

function formatPath(root: string, segments: Array<string | number>): string {
  return segments.reduce<string>(
    (path, segment) =>
      typeof segment === 'number'
        ? `${path}[${segment}]`
        : `${path}.${segment}`,
    root,
  );
}
