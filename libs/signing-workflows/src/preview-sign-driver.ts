import { randomBytes as nodeRandomBytes } from 'node:crypto';

import { canonicalJsonBytes } from '@moltnet/crypto-service';
import {
  ARKG_KEY_TYPE,
  ARKG_P256_ALGORITHM,
  type CoseArkgSeedPublicMaterial,
  type CoseEc2PublicKey,
  createPreviewSignPrehash,
  deriveArkgPublicKey,
  ESP256_ALGORITHM,
  validateCoseEc2PublicKey,
  verifyP256PrehashedSignature,
} from '@themoltnet/yubikey-preview-sign/protocol';

import {
  assertNoPrivateSigningMaterial,
  SigningCredentialError,
} from './signing-credentials.js';
import {
  type PrepareSigningClaimInput,
  type SigningMethodDriver,
  type SigningMethodJson,
  type SigningMethodReceipt,
  SigningReceiptInvalidError,
  VERIFICATION_METHOD,
  type VerificationEvidence,
} from './signing-workflows.js';

export const PREVIEW_SIGN_CREDENTIAL_TYPE = 'preview-sign-arkg';
export const PREVIEW_SIGN_ALGORITHM = 'arkg-p256-esp256';
export const PREVIEW_SIGN_PUBLIC_MATERIAL_VERSION = 1;
export const PREVIEW_SIGN_CHALLENGE_VERSION = 1;
export const PREVIEW_SIGN_RECEIPT_VERSION = 1;
export const PREVIEW_SIGN_EVIDENCE_VERSION = 1;
export const PREVIEW_SIGN_ENVELOPE_VERSION = 1;
export const PREVIEW_SIGN_AUDIENCE = 'moltnet:preview-sign';

const METHOD = VERIFICATION_METHOD.HumanHardwarePreviewSign;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_OPAQUE_BYTES = 4096;
const REQUIRED_MATERIAL_KEYS = [
  'outerCredentialId',
  'outerPublicKey',
  'previewKeyHandle',
  'seedPublicKey',
  'version',
] as const;

export interface PreviewSignEc2PublicKey extends CoseEc2PublicKey {
  [key: string]: SigningMethodJson;
}

export interface PreviewSignArkgSeedPublicMaterial {
  [key: string]: SigningMethodJson;
  kty: typeof ARKG_KEY_TYPE;
  algorithm: typeof ARKG_P256_ALGORITHM;
  derivedAlgorithm: typeof ESP256_ALGORITHM;
  blindingKey: PreviewSignEc2PublicKey;
  kemKey: PreviewSignEc2PublicKey;
}

export interface PreviewSignPublicMaterialV1 {
  [key: string]: SigningMethodJson;
  version: typeof PREVIEW_SIGN_PUBLIC_MATERIAL_VERSION;
  outerCredentialId: string;
  outerPublicKey: PreviewSignEc2PublicKey;
  previewKeyHandle: string;
  seedPublicKey: PreviewSignArkgSeedPublicMaterial;
}

interface PreviewSignVerifierStateV1 {
  version: typeof PREVIEW_SIGN_CHALLENGE_VERSION;
  operation: 'credential-registration' | 'signing-request';
  requestId: string;
  credentialId: string;
  teamId: string;
  claimantId: string;
  nonce: string;
  purpose: string;
  expiresAt: string;
  signingPayload: string;
  publicMaterialHash: string;
  envelope: string;
  digest: string;
  additionalArgumentsHash: string;
  derivedPublicKey: PreviewSignEc2PublicKey;
}

export interface PreviewSignEvidenceV1 {
  version: typeof PREVIEW_SIGN_EVIDENCE_VERSION;
  operation: 'credential-registration' | 'signing-request';
  requestId: string;
  credentialId: string;
  teamId: string;
  claimantId: string;
  verificationMethod: typeof METHOD;
  nonce: string;
  purpose: string;
  expiresAt: string;
  envelope: string;
  digest: string;
  additionalArgumentsHash: string;
  derivedPublicKey: PreviewSignEc2PublicKey;
  signature: string;
  proofHash: string;
}

export interface PreviewSignDriverOptions {
  randomBytes?: (size: number) => Uint8Array;
  now?: () => Date;
  verifyPrehashedSignature?: (
    digest: Uint8Array,
    signature: Uint8Array,
    publicKey: CoseEc2PublicKey,
  ) => boolean;
}

function invalidPublicMaterial(message: string): never {
  throw new SigningCredentialError(
    'credential_public_material_invalid',
    message,
  );
}

function record(value: SigningMethodJson, field: string) {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new SigningReceiptInvalidError(`${field} must be a JSON object`);
  }
  return value;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  field: string,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    throw new SigningReceiptInvalidError(
      `${field} contains unsupported or missing fields`,
    );
  }
}

function strictBase64Url(
  value: unknown,
  field: string,
  options: { exactBytes?: number; maxBytes?: number } = {},
): Uint8Array {
  if (
    typeof value !== 'string' ||
    !BASE64URL_PATTERN.test(value) ||
    value.includes('=')
  ) {
    throw new SigningReceiptInvalidError(`${field} must be unpadded base64url`);
  }
  const decoded = Buffer.from(value, 'base64url');
  if (
    decoded.toString('base64url') !== value ||
    (options.exactBytes !== undefined &&
      decoded.length !== options.exactBytes) ||
    decoded.length === 0 ||
    decoded.length > (options.maxBytes ?? MAX_OPAQUE_BYTES)
  ) {
    throw new SigningReceiptInvalidError(`${field} has an invalid length`);
  }
  return decoded;
}

function publicMaterialBase64Url(value: unknown, field: string): Uint8Array {
  try {
    return strictBase64Url(value, field);
  } catch (error) {
    if (error instanceof SigningReceiptInvalidError) {
      invalidPublicMaterial(error.message);
    }
    throw error;
  }
}

function parseEc2PublicKey(
  value: unknown,
  field: string,
  algorithm: number,
): PreviewSignEc2PublicKey {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    invalidPublicMaterial(`${field} must be a P-256 public key`);
  }
  const key = value as Record<string, unknown>;
  const keys = Object.keys(key).sort();
  if (
    keys.join(',') !== 'algorithm,curve,kty,x,y' ||
    key['kty'] !== 2 ||
    key['curve'] !== 1 ||
    key['algorithm'] !== algorithm
  ) {
    invalidPublicMaterial(`${field} must use the required P-256 algorithm`);
  }
  publicMaterialBase64Url(key['x'], `${field}.x`);
  publicMaterialBase64Url(key['y'], `${field}.y`);
  const parsed: PreviewSignEc2PublicKey = {
    kty: 2,
    algorithm,
    curve: 1,
    x: key['x'] as string,
    y: key['y'] as string,
  };
  try {
    validateCoseEc2PublicKey(parsed);
  } catch {
    invalidPublicMaterial(`${field} is not a valid P-256 point`);
  }
  return parsed;
}

function parsePublicMaterial(
  value: SigningMethodJson,
): PreviewSignPublicMaterialV1 {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    invalidPublicMaterial('previewSign public material must be an object');
  }
  const material = value as Record<string, unknown>;
  const keys = Object.keys(material).sort();
  if (keys.join(',') !== [...REQUIRED_MATERIAL_KEYS].sort().join(',')) {
    invalidPublicMaterial(
      'previewSign public material contains unsupported or missing fields',
    );
  }
  if (material['version'] !== PREVIEW_SIGN_PUBLIC_MATERIAL_VERSION) {
    invalidPublicMaterial('Unsupported previewSign public material version');
  }
  publicMaterialBase64Url(
    material['outerCredentialId'],
    'publicMaterial.outerCredentialId',
  );
  publicMaterialBase64Url(
    material['previewKeyHandle'],
    'publicMaterial.previewKeyHandle',
  );
  const outerPublicKey = parseEc2PublicKey(
    material['outerPublicKey'],
    'publicMaterial.outerPublicKey',
    -7,
  );
  const seed = material['seedPublicKey'];
  if (!seed || Array.isArray(seed) || typeof seed !== 'object') {
    invalidPublicMaterial('publicMaterial.seedPublicKey must be an object');
  }
  const seedRecord = seed as Record<string, unknown>;
  if (
    Object.keys(seedRecord).sort().join(',') !==
      'algorithm,blindingKey,derivedAlgorithm,kemKey,kty' ||
    seedRecord['kty'] !== ARKG_KEY_TYPE ||
    seedRecord['algorithm'] !== ARKG_P256_ALGORITHM ||
    seedRecord['derivedAlgorithm'] !== ESP256_ALGORITHM
  ) {
    invalidPublicMaterial(
      'publicMaterial.seedPublicKey uses unsupported ARKG parameters',
    );
  }
  const blindingKey = parseEc2PublicKey(
    seedRecord['blindingKey'],
    'publicMaterial.seedPublicKey.blindingKey',
    -7,
  );
  const kemKey = parseEc2PublicKey(
    seedRecord['kemKey'],
    'publicMaterial.seedPublicKey.kemKey',
    -25,
  );
  return {
    version: PREVIEW_SIGN_PUBLIC_MATERIAL_VERSION,
    outerCredentialId: material['outerCredentialId'] as string,
    outerPublicKey,
    previewKeyHandle: material['previewKeyHandle'] as string,
    seedPublicKey: {
      kty: ARKG_KEY_TYPE,
      algorithm: ARKG_P256_ALGORITHM,
      derivedAlgorithm: ESP256_ALGORITHM,
      blindingKey,
      kemKey,
    },
  };
}

function digestBase64Url(bytes: Uint8Array): string {
  return Buffer.from(createPreviewSignPrehash(bytes)).toString('base64url');
}

function publicMaterialHash(material: PreviewSignPublicMaterialV1): string {
  return digestBase64Url(canonicalJsonBytes(material));
}

function requireBinding(input: PrepareSigningClaimInput) {
  const operation = input.operation ?? 'signing-request';
  if (
    (operation !== 'credential-registration' &&
      operation !== 'signing-request') ||
    !input.teamId ||
    !input.claimantId ||
    !input.purpose ||
    !input.nonce ||
    !input.expiresAt ||
    !input.credentialPublicMaterial
  ) {
    throw new SigningReceiptInvalidError(
      'previewSign requires complete server-owned binding state',
    );
  }
  const expiresAt = new Date(input.expiresAt);
  if (
    !Number.isFinite(expiresAt.getTime()) ||
    expiresAt.toISOString() !== input.expiresAt
  ) {
    throw new SigningReceiptInvalidError(
      'previewSign expiry must be an ISO-8601 instant',
    );
  }
  return {
    operation,
    teamId: input.teamId,
    claimantId: input.claimantId,
    purpose: input.purpose,
    nonce: input.nonce,
    expiresAt: input.expiresAt,
    material: parsePublicMaterial(input.credentialPublicMaterial),
  };
}

function envelopeBytes(
  input: PrepareSigningClaimInput,
  binding: ReturnType<typeof requireBinding>,
  publicMaterialHash: string,
): Uint8Array {
  return canonicalJsonBytes({
    version: PREVIEW_SIGN_ENVELOPE_VERSION,
    audience: PREVIEW_SIGN_AUDIENCE,
    operation: binding.operation,
    requestId: input.requestId,
    credentialId: input.credentialId,
    verificationMethod: METHOD,
    teamId: binding.teamId,
    claimantId: binding.claimantId,
    nonce: binding.nonce,
    purpose: binding.purpose,
    expiresAt: binding.expiresAt,
    signingPayload: input.signingPayload,
    publicMaterialHash,
  });
}

function parseVerifierState(
  value: SigningMethodJson,
): PreviewSignVerifierStateV1 {
  const state = record(value, 'previewSign verifier state');
  exactKeys(
    state,
    [
      'additionalArgumentsHash',
      'claimantId',
      'credentialId',
      'derivedPublicKey',
      'digest',
      'envelope',
      'expiresAt',
      'nonce',
      'operation',
      'publicMaterialHash',
      'purpose',
      'requestId',
      'signingPayload',
      'teamId',
      'version',
    ],
    'previewSign verifier state',
  );
  if (state['version'] !== PREVIEW_SIGN_CHALLENGE_VERSION) {
    throw new SigningReceiptInvalidError(
      'Unsupported previewSign verifier-state version',
    );
  }
  const requiredString = (key: string): string => {
    const field = state[key];
    if (typeof field !== 'string' || field.length === 0) {
      throw new SigningReceiptInvalidError(
        `verifierState.${key} must be a non-empty string`,
      );
    }
    return field;
  };
  const operation = state['operation'];
  if (
    operation !== 'credential-registration' &&
    operation !== 'signing-request'
  ) {
    throw new SigningReceiptInvalidError(
      'verifierState.operation is unsupported',
    );
  }
  const expiresAt = requiredString('expiresAt');
  const parsedExpiry = new Date(expiresAt);
  if (
    !Number.isFinite(parsedExpiry.getTime()) ||
    parsedExpiry.toISOString() !== expiresAt
  ) {
    throw new SigningReceiptInvalidError(
      'verifierState.expiresAt must be an ISO-8601 instant',
    );
  }
  let derivedPublicKey: PreviewSignEc2PublicKey;
  try {
    derivedPublicKey = parseEc2PublicKey(
      state['derivedPublicKey'],
      'verifierState.derivedPublicKey',
      ESP256_ALGORITHM,
    );
  } catch (error) {
    if (error instanceof SigningCredentialError) {
      throw new SigningReceiptInvalidError(error.message, {
        cause: error,
        reason: 'binding_mismatch',
      });
    }
    throw error;
  }
  const digest = requiredString('digest');
  const additionalArgumentsHash = requiredString('additionalArgumentsHash');
  strictBase64Url(requiredString('publicMaterialHash'), 'publicMaterialHash', {
    exactBytes: 32,
  });
  strictBase64Url(requiredString('envelope'), 'verifierState.envelope');
  strictBase64Url(digest, 'verifierState.digest', { exactBytes: 32 });
  strictBase64Url(additionalArgumentsHash, 'additionalArgumentsHash', {
    exactBytes: 32,
  });
  return {
    version: PREVIEW_SIGN_CHALLENGE_VERSION,
    operation,
    requestId: requiredString('requestId'),
    credentialId: requiredString('credentialId'),
    teamId: requiredString('teamId'),
    claimantId: requiredString('claimantId'),
    nonce: requiredString('nonce'),
    purpose: requiredString('purpose'),
    expiresAt,
    signingPayload: requiredString('signingPayload'),
    publicMaterialHash: requiredString('publicMaterialHash'),
    envelope: requiredString('envelope'),
    digest,
    additionalArgumentsHash,
    derivedPublicKey,
  };
}

function parseReceipt(receipt: SigningMethodReceipt) {
  const value = receipt as Record<string, unknown>;
  exactKeys(
    value,
    ['signature', 'verificationMethod', 'version'],
    'previewSign receipt',
  );
  if (
    value['verificationMethod'] !== METHOD ||
    value['version'] !== PREVIEW_SIGN_RECEIPT_VERSION
  ) {
    throw new SigningReceiptInvalidError(
      'Unsupported previewSign receipt version or method',
    );
  }
  const signature = strictBase64Url(value['signature'], 'receipt.signature', {
    maxBytes: 72,
  });
  if (signature.length < 8 || signature[0] !== 0x30) {
    throw new SigningReceiptInvalidError(
      'receipt.signature must be canonical DER',
    );
  }
  return {
    signature,
    encoded: value['signature'] as string,
  };
}

function replayMatches(
  receipt: SigningMethodReceipt,
  evidence: SigningMethodJson,
): boolean {
  try {
    const parsedReceipt = parseReceipt(receipt);
    const value = record(evidence, 'previewSign evidence');
    exactKeys(
      value,
      [
        'additionalArgumentsHash',
        'claimantId',
        'credentialId',
        'derivedPublicKey',
        'digest',
        'envelope',
        'expiresAt',
        'nonce',
        'operation',
        'proofHash',
        'purpose',
        'requestId',
        'signature',
        'teamId',
        'verificationMethod',
        'version',
      ],
      'previewSign evidence',
    );
    const proofHash = value['proofHash'];
    strictBase64Url(proofHash, 'evidence.proofHash', { exactBytes: 32 });
    const { proofHash: _proofHash, ...evidenceWithoutHash } = value;
    return (
      value['version'] === PREVIEW_SIGN_EVIDENCE_VERSION &&
      value['operation'] === 'signing-request' &&
      value['verificationMethod'] === METHOD &&
      value['signature'] === parsedReceipt.encoded &&
      proofHash === digestBase64Url(canonicalJsonBytes(evidenceWithoutHash))
    );
  } catch {
    return false;
  }
}

export function createPreviewSignSigningMethodDriver(
  options: PreviewSignDriverOptions = {},
): SigningMethodDriver {
  const randomBytes = options.randomBytes ?? nodeRandomBytes;
  const now = options.now ?? (() => new Date());
  const verifyPrehashed =
    options.verifyPrehashedSignature ?? verifyP256PrehashedSignature;

  return {
    verificationMethod: METHOD,

    async verify() {
      // previewSign only verifies through the typed claim/receipt lifecycle.
      return false;
    },

    validatePublicMaterial(input) {
      if (
        input.verificationMethod !== METHOD ||
        input.credentialType !== PREVIEW_SIGN_CREDENTIAL_TYPE ||
        input.algorithm !== PREVIEW_SIGN_ALGORITHM
      ) {
        invalidPublicMaterial(
          'Credential does not use the stable previewSign type and algorithm',
        );
      }
      assertNoPrivateSigningMaterial(input.publicMaterial);
      parsePublicMaterial(input.publicMaterial);
    },

    normalizePublicMaterial(input) {
      return parsePublicMaterial(input.publicMaterial);
    },

    validateRegistrationBinding(input) {
      const material = parsePublicMaterial(input.publicMaterial);
      const state = parseVerifierState(input.verifierState);
      if (state.publicMaterialHash !== publicMaterialHash(material)) {
        throw new SigningReceiptInvalidError(
          'previewSign enrollment material does not match the persisted registration binding',
          { reason: 'binding_mismatch' },
        );
      }
    },

    async prepareClaim(input) {
      const binding = requireBinding(input);
      const materialHash = publicMaterialHash(binding.material);
      const bytes = envelopeBytes(input, binding, materialHash);
      const envelope = Buffer.from(bytes).toString('base64url');
      const digest = digestBase64Url(bytes);
      const ikm = Uint8Array.from(randomBytes(32));
      if (ikm.length !== 32) {
        throw new SigningReceiptInvalidError(
          'previewSign entropy source must return exactly 32 bytes',
        );
      }
      const context = createPreviewSignPrehash(
        Buffer.concat([
          Buffer.from('moltnet:preview-sign:arkg-context:v1\0', 'utf8'),
          bytes,
        ]),
      );
      const seed: CoseArkgSeedPublicMaterial = binding.material.seedPublicKey;
      const derived = deriveArkgPublicKey(seed, ikm, context);
      const additionalArguments = Buffer.from(
        derived.additionalArguments,
      ).toString('base64url');
      const additionalArgumentsHash = digestBase64Url(
        derived.additionalArguments,
      );
      const state: PreviewSignVerifierStateV1 = {
        version: PREVIEW_SIGN_CHALLENGE_VERSION,
        operation: binding.operation,
        requestId: input.requestId,
        credentialId: input.credentialId,
        teamId: binding.teamId,
        claimantId: binding.claimantId,
        nonce: binding.nonce,
        purpose: binding.purpose,
        expiresAt: binding.expiresAt,
        signingPayload: input.signingPayload,
        publicMaterialHash: materialHash,
        envelope,
        digest,
        additionalArgumentsHash,
        derivedPublicKey:
          derived.publicKey as unknown as PreviewSignEc2PublicKey,
      };
      return {
        challenge: {
          verificationMethod: METHOD,
          version: PREVIEW_SIGN_CHALLENGE_VERSION,
          envelope,
          digest,
          additionalArguments,
          outerCredentialId: binding.material.outerCredentialId,
          outerPublicKey: binding.material.outerPublicKey,
          previewKeyHandle: binding.material.previewKeyHandle,
        },
        verifierState: state as unknown as SigningMethodJson,
      };
    },

    async verifyReceipt(input): Promise<VerificationEvidence> {
      const binding = requireBinding(input);
      const state = parseVerifierState(input.verifierState);
      const materialHash = publicMaterialHash(binding.material);
      const bytes = envelopeBytes(input, binding, materialHash);
      const expectedEnvelope = Buffer.from(bytes).toString('base64url');
      const expectedDigest = digestBase64Url(bytes);
      const bindingsMatch =
        state.operation === binding.operation &&
        state.requestId === input.requestId &&
        state.credentialId === input.credentialId &&
        state.teamId === binding.teamId &&
        state.claimantId === binding.claimantId &&
        state.nonce === binding.nonce &&
        state.purpose === binding.purpose &&
        state.expiresAt === binding.expiresAt &&
        state.signingPayload === input.signingPayload &&
        state.publicMaterialHash === materialHash &&
        state.envelope === expectedEnvelope &&
        state.digest === expectedDigest;
      if (!bindingsMatch) {
        throw new SigningReceiptInvalidError(
          'previewSign receipt does not match the persisted server binding',
          { reason: 'binding_mismatch' },
        );
      }
      if (new Date(binding.expiresAt) <= now()) {
        throw new SigningReceiptInvalidError(
          'previewSign challenge has expired',
          { reason: 'expired' },
        );
      }
      const receipt = parseReceipt(input.receipt);
      let valid: boolean;
      try {
        valid = verifyPrehashed(
          Buffer.from(state.digest, 'base64url'),
          receipt.signature,
          state.derivedPublicKey,
        );
      } catch (error) {
        throw new SigningReceiptInvalidError(
          'previewSign signature verification failed',
          { cause: error, reason: 'signature_verification_failed' },
        );
      }
      if (!valid) {
        throw new SigningReceiptInvalidError(
          'previewSign signature is invalid',
          { reason: 'signature_invalid' },
        );
      }
      const evidenceWithoutHash: Omit<PreviewSignEvidenceV1, 'proofHash'> = {
        version: PREVIEW_SIGN_EVIDENCE_VERSION,
        operation: state.operation,
        requestId: state.requestId,
        credentialId: state.credentialId,
        teamId: state.teamId,
        claimantId: state.claimantId,
        verificationMethod: METHOD,
        nonce: state.nonce,
        purpose: state.purpose,
        expiresAt: state.expiresAt,
        envelope: state.envelope,
        digest: state.digest,
        additionalArgumentsHash: state.additionalArgumentsHash,
        derivedPublicKey: state.derivedPublicKey,
        signature: receipt.encoded,
      };
      const proofHash = digestBase64Url(
        canonicalJsonBytes(evidenceWithoutHash),
      );
      const details: PreviewSignEvidenceV1 = {
        ...evidenceWithoutHash,
        proofHash,
      };
      return {
        verificationMethod: METHOD,
        credentialId: state.credentialId,
        proofHash,
        details: details as unknown as SigningMethodJson,
      };
    },

    isReceiptReplay(receipt, evidence) {
      return replayMatches(receipt, evidence);
    },
  };
}
