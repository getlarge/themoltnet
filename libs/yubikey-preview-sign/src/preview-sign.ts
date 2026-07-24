import { randomBytes } from 'node:crypto';

import { type CtapConnection } from '@themoltnet/ctap';
import {
  asMap,
  decodeCbor,
  decodeCborPrefix,
  encodeCbor,
  mapBytes,
  mapNumber,
  mapString,
} from '@themoltnet/ctap/cbor';

import {
  ESP256_SPLIT_ARKG_PLACEHOLDER,
  parseArkgSeedPublicKey,
  parseCoseEc2PublicKey,
} from './arkg.js';
import {
  bytesEqual,
  concatBytes,
  readU32be,
  sha256,
  toBase64Url,
  utf8,
} from './bytes.js';
import { invariant, PreviewSignError } from './errors.js';
import {
  normalizeP256DerSignature,
  verifyP256Signature,
} from './p256-verify.js';
import type {
  CoseArkgSeedPublicKey,
  CoseEc2PublicKey,
  PreviewSignCapabilities,
} from './types.js';
import { PreviewSignPresence } from './types.js';

const CTAP_MAKE_CREDENTIAL = 0x01;
const CTAP_GET_ASSERTION = 0x02;
const CTAP_GET_INFO = 0x04;
const PREVIEW_SIGN = 'previewSign';
export const DEFAULT_PREVIEW_SIGN_RP_ID = 'preview-sign.local';
export const DEFAULT_PREVIEW_SIGN_RP_NAME = 'Preview sign client';

const AUTH_DATA_USER_PRESENT = 0x01;
const AUTH_DATA_USER_VERIFIED = 0x04;
const AUTH_DATA_ATTESTED_CREDENTIAL = 0x40;
const AUTH_DATA_EXTENSIONS = 0x80;
const RESPONSE_FORMAT = 1;
const RESPONSE_AUTH_DATA = 2;
const RESPONSE_SIGNATURE = 3;
const RESPONSE_UNSIGNED_EXTENSIONS = 6;
// Numeric keys are scoped to separate previewSign request/output CBOR maps.
const PREVIEW_REQUEST_KEYS = {
  keyHandle: 2,
  algorithms: 3,
  presence: 4,
  toBeSigned: 6,
  additionalArguments: 7,
} as const;
const PREVIEW_OUTPUT_KEYS = {
  signature: 6,
  attestationObject: 7,
} as const;

interface AttestedCredentialData {
  credentialId: Uint8Array;
  publicKeyValue: unknown;
  publicKeyBytes: Uint8Array;
}

export interface ParsedAuthenticatorData {
  raw: Uint8Array;
  rpIdHash: Uint8Array;
  flags: number;
  signCount: number;
  attestedCredential?: AttestedCredentialData;
  extensions?: Map<unknown, unknown>;
}

export function parseAuthenticatorData(
  value: Uint8Array,
): ParsedAuthenticatorData {
  invariant(
    value.length >= 37,
    'INVALID_RESPONSE',
    'Authenticator data is too short',
  );
  const flags = value[32] ?? 0;
  const result: ParsedAuthenticatorData = {
    raw: value,
    rpIdHash: value.slice(0, 32),
    flags,
    signCount: readU32be(value, 33),
  };
  let offset = 37;
  if (flags & AUTH_DATA_ATTESTED_CREDENTIAL) {
    invariant(
      value.length >= offset + 18,
      'INVALID_RESPONSE',
      'Attested data is truncated',
    );
    offset += 16;
    const credentialLength =
      ((value[offset] ?? 0) << 8) | (value[offset + 1] ?? 0);
    offset += 2;
    invariant(
      value.length >= offset + credentialLength,
      'INVALID_RESPONSE',
      'Credential ID is truncated',
    );
    const credentialId = value.slice(offset, offset + credentialLength);
    offset += credentialLength;
    const decoded = decodeCborPrefix(value.slice(offset));
    const publicKeyBytes = value.slice(offset, offset + decoded.bytesRead);
    offset += decoded.bytesRead;
    result.attestedCredential = {
      credentialId,
      publicKeyValue: decoded.value,
      publicKeyBytes,
    };
  }
  if (flags & AUTH_DATA_EXTENSIONS) {
    result.extensions = asMap(
      decodeCbor(value.slice(offset)),
      'Authenticator extensions',
    );
  }
  return result;
}

function stringArray(value: unknown, field: string): string[] {
  invariant(
    Array.isArray(value) && value.every((item) => typeof item === 'string'),
    'INVALID_RESPONSE',
    `${field} must contain strings`,
  );
  return value;
}

function boolRecord(value: unknown): Record<string, boolean> {
  if (!(value instanceof Map)) return {};
  return Object.fromEntries(
    [...value].filter(
      (entry): entry is [string, boolean] =>
        typeof entry[0] === 'string' && typeof entry[1] === 'boolean',
    ),
  );
}

export function parseGetInfo(
  encoded: Uint8Array,
  device: CtapConnection['device'],
): PreviewSignCapabilities {
  const response = asMap(decodeCbor(encoded), 'getInfo response');
  const versions = stringArray(response.get(1), 'getInfo versions');
  const extensions = response.has(2)
    ? stringArray(response.get(2), 'getInfo extensions')
    : [];
  const aaguid = response.get(3);
  const supportsPreviewSign = extensions.includes(PREVIEW_SIGN);
  return {
    device,
    versions,
    extensions,
    options: boolRecord(response.get(4)),
    aaguid:
      aaguid instanceof Uint8Array
        ? toBase64Url(new Uint8Array(aaguid))
        : undefined,
    supportsPreviewSign,
    supportsCtap23: versions.includes('FIDO_2_2') || supportsPreviewSign,
  };
}

export interface GeneratedPreviewKey {
  outerCredentialId: Uint8Array;
  outerPublicKey: CoseEc2PublicKey;
  previewKeyHandle: Uint8Array;
  seedPublicKey: CoseArkgSeedPublicKey;
  algorithm: typeof ESP256_SPLIT_ARKG_PLACEHOLDER;
  attestation: {
    format: string;
    object: Uint8Array;
    verified: boolean;
    trust: 'self' | 'unverified';
  };
}

export class PreviewSignCtapClient {
  readonly connection: CtapConnection;
  readonly rpId: string;
  readonly rpName: string;

  constructor(
    connection: CtapConnection,
    options: { rpId?: string; rpName?: string } = {},
  ) {
    this.connection = connection;
    this.rpId = options.rpId ?? DEFAULT_PREVIEW_SIGN_RP_ID;
    this.rpName = options.rpName ?? DEFAULT_PREVIEW_SIGN_RP_NAME;
  }

  async getCapabilities(): Promise<PreviewSignCapabilities> {
    return parseGetInfo(
      await this.connection.cbor(CTAP_GET_INFO),
      this.connection.device,
    );
  }

  async generateKey(
    presence = PreviewSignPresence.RequireUserPresence,
  ): Promise<GeneratedPreviewKey> {
    const capabilities = await this.getCapabilities();
    if (!capabilities.supportsPreviewSign) {
      throw new PreviewSignError(
        'UNSUPPORTED_DEVICE',
        'Connected authenticator does not advertise previewSign',
        {
          versions: capabilities.versions,
          extensions: capabilities.extensions,
        },
      );
    }
    const request = new Map<unknown, unknown>([
      [1, new Uint8Array(randomBytes(32))],
      [
        2,
        new Map<unknown, unknown>([
          ['id', this.rpId],
          ['name', this.rpName],
        ]),
      ],
      [
        3,
        new Map<unknown, unknown>([
          ['id', new Uint8Array(randomBytes(32))],
          ['name', 'approval-key'],
          ['displayName', 'Preview sign key'],
        ]),
      ],
      [
        4,
        [
          new Map<unknown, unknown>([
            ['type', 'public-key'],
            ['alg', -7],
          ]),
        ],
      ],
      [
        6,
        new Map([
          [
            PREVIEW_SIGN,
            new Map<unknown, unknown>([
              [
                PREVIEW_REQUEST_KEYS.algorithms,
                [ESP256_SPLIT_ARKG_PLACEHOLDER],
              ],
              [PREVIEW_REQUEST_KEYS.presence, presence],
            ]),
          ],
        ]),
      ],
      [
        7,
        new Map([
          ['rk', false],
          ['uv', presence === PreviewSignPresence.RequireUserVerification],
        ]),
      ],
    ]);
    const response = asMap(
      decodeCbor(
        await this.connection.cbor(
          CTAP_MAKE_CREDENTIAL,
          encodeCbor(request),
          60_000,
        ),
      ),
      'makeCredential response',
    );
    const outerAuthData = parseAuthenticatorData(
      mapBytes(response, RESPONSE_AUTH_DATA, 'makeCredential authData'),
    );
    invariant(
      bytesEqual(outerAuthData.rpIdHash, sha256(utf8(this.rpId))),
      'INVALID_RESPONSE',
      'makeCredential returned the wrong relying-party hash',
    );
    invariant(
      outerAuthData.attestedCredential,
      'INVALID_RESPONSE',
      'makeCredential did not return an outer credential',
    );
    const signedPreviewOutput = asMap(
      outerAuthData.extensions?.get(PREVIEW_SIGN),
      'previewSign signed output',
    );
    invariant(
      mapNumber(
        signedPreviewOutput,
        PREVIEW_REQUEST_KEYS.algorithms,
        'previewSign algorithm',
      ) === ESP256_SPLIT_ARKG_PLACEHOLDER,
      'INVALID_RESPONSE',
      'Authenticator selected an unexpected previewSign algorithm',
    );
    const unsignedPreview = asMap(
      asMap(
        response.get(RESPONSE_UNSIGNED_EXTENSIONS),
        'unsigned extension outputs',
      ).get(PREVIEW_SIGN),
      'unsigned previewSign output',
    );
    const attestationObject = mapBytes(
      unsignedPreview,
      PREVIEW_OUTPUT_KEYS.attestationObject,
      'previewSign attestation object',
    );
    const innerResponse = asMap(
      decodeCbor(attestationObject),
      'previewSign embedded attestation response',
    );
    const innerAuthData = parseAuthenticatorData(
      mapBytes(
        innerResponse,
        RESPONSE_AUTH_DATA,
        'embedded attestation authData',
      ),
    );
    invariant(
      innerAuthData.attestedCredential,
      'INVALID_RESPONSE',
      'Embedded attestation did not contain a previewSign key',
    );
    return {
      outerCredentialId: outerAuthData.attestedCredential.credentialId,
      outerPublicKey: parseCoseEc2PublicKey(
        outerAuthData.attestedCredential.publicKeyValue,
      ),
      previewKeyHandle: innerAuthData.attestedCredential.credentialId,
      seedPublicKey: parseArkgSeedPublicKey(
        innerAuthData.attestedCredential.publicKeyValue,
        innerAuthData.attestedCredential.publicKeyBytes,
      ),
      algorithm: ESP256_SPLIT_ARKG_PLACEHOLDER,
      attestation: {
        format: mapString(
          innerResponse,
          RESPONSE_FORMAT,
          'embedded attestation format',
        ),
        object: attestationObject,
        verified: false,
        trust: 'unverified',
      },
    };
  }

  async signByCredential(input: {
    outerCredentialId: Uint8Array;
    outerPublicKey: CoseEc2PublicKey;
    previewKeyHandle: Uint8Array;
    toBeSigned: Uint8Array;
    additionalArguments: Uint8Array;
    presence?: PreviewSignPresence;
  }): Promise<Uint8Array> {
    invariant(
      input.toBeSigned.length > 0,
      'INVALID_INPUT',
      'Digest cannot be empty',
    );
    const clientDataHash = sha256(
      concatBytes(utf8('preview-sign.assertion.v1'), input.toBeSigned),
    );
    const presence = input.presence ?? PreviewSignPresence.RequireUserPresence;
    const request = new Map<unknown, unknown>([
      [1, this.rpId],
      [2, clientDataHash],
      [
        3,
        [
          new Map<unknown, unknown>([
            ['type', 'public-key'],
            ['id', input.outerCredentialId],
          ]),
        ],
      ],
      [
        4,
        new Map([
          [
            PREVIEW_SIGN,
            new Map<unknown, unknown>([
              [PREVIEW_REQUEST_KEYS.keyHandle, input.previewKeyHandle],
              [PREVIEW_REQUEST_KEYS.toBeSigned, input.toBeSigned],
              [
                PREVIEW_REQUEST_KEYS.additionalArguments,
                input.additionalArguments,
              ],
            ]),
          ],
        ]),
      ],
      [
        5,
        new Map([
          ['up', presence !== PreviewSignPresence.Unattended],
          ['uv', presence === PreviewSignPresence.RequireUserVerification],
        ]),
      ],
    ]);
    const response = asMap(
      decodeCbor(
        await this.connection.cbor(
          CTAP_GET_ASSERTION,
          encodeCbor(request),
          60_000,
        ),
      ),
      'getAssertion response',
    );
    const authDataBytes = mapBytes(
      response,
      RESPONSE_AUTH_DATA,
      'getAssertion authData',
    );
    const authData = parseAuthenticatorData(authDataBytes);
    invariant(
      bytesEqual(authData.rpIdHash, sha256(utf8(this.rpId))),
      'VERIFICATION_FAILED',
      'Assertion returned the wrong relying-party hash',
    );
    if (presence !== PreviewSignPresence.Unattended) {
      invariant(
        (authData.flags & AUTH_DATA_USER_PRESENT) !== 0,
        'VERIFICATION_FAILED',
        'Assertion did not prove user presence',
      );
    }
    if (presence === PreviewSignPresence.RequireUserVerification) {
      invariant(
        (authData.flags & AUTH_DATA_USER_VERIFIED) !== 0,
        'VERIFICATION_FAILED',
        'Assertion did not prove user verification',
      );
    }
    invariant(
      verifyP256Signature(
        concatBytes(authDataBytes, clientDataHash),
        mapBytes(response, RESPONSE_SIGNATURE, 'getAssertion signature'),
        input.outerPublicKey,
      ),
      'VERIFICATION_FAILED',
      'Outer credential assertion signature is invalid',
    );
    return normalizeP256DerSignature(
      mapBytes(
        asMap(
          authData.extensions?.get(PREVIEW_SIGN),
          'previewSign assertion output',
        ),
        PREVIEW_OUTPUT_KEYS.signature,
        'previewSign signature',
      ),
    );
  }
}
