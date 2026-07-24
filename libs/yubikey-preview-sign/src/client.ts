import { randomBytes } from 'node:crypto';

import {
  type CtapConnection,
  CtapHidTransport,
  type HidProvider,
  listFidoDevices,
  NodeHidProvider,
} from '@themoltnet/ctap';

import { deriveArkgPublicKey } from './arkg.js';
import {
  bytesEqual,
  concatBytes,
  fromBase64Url,
  sha256,
  toBase64Url,
  utf8,
} from './bytes.js';
import { invariant } from './errors.js';
import { verifyP256PrehashedSignature } from './p256-verify.js';
import {
  DEFAULT_PREVIEW_SIGN_RP_ID,
  DEFAULT_PREVIEW_SIGN_RP_NAME,
  PreviewSignCtapClient,
} from './preview-sign.js';
import type {
  DeviceDescriptor,
  EnrollmentRecordV1,
  PreviewSignCapabilities,
  VerificationKeyRecordV1,
} from './types.js';
import { PreviewSignPresence } from './types.js';

export interface PreviewSignClientOptions {
  provider?: HidProvider;
  connect?: (
    deviceId?: string,
  ) => Promise<CtapConnection & { close?: () => Promise<void> }>;
  now?: () => Date;
  rpId?: string;
  rpName?: string;
}

export interface SignDigestInput {
  enrollment: EnrollmentRecordV1;
  digest: Uint8Array;
  deviceId?: string;
  context?: Uint8Array;
  ikm?: Uint8Array;
  presence?: PreviewSignPresence;
  allowUnverifiedEnrollment?: boolean;
}

export interface SignDigestResult {
  signature: Uint8Array;
  verificationKey: VerificationKeyRecordV1;
}

export class PreviewSignClient {
  private readonly provider: HidProvider;
  private readonly connectOverride?: PreviewSignClientOptions['connect'];
  private readonly now: () => Date;
  private readonly rpId: string;
  private readonly rpName: string;

  constructor(options: PreviewSignClientOptions = {}) {
    this.provider = options.provider ?? new NodeHidProvider();
    this.connectOverride = options.connect;
    this.now = options.now ?? (() => new Date());
    this.rpId = options.rpId ?? DEFAULT_PREVIEW_SIGN_RP_ID;
    this.rpName = options.rpName ?? DEFAULT_PREVIEW_SIGN_RP_NAME;
  }

  async listDevices(): Promise<DeviceDescriptor[]> {
    return listFidoDevices(this.provider);
  }

  async getCapabilities(deviceId?: string): Promise<PreviewSignCapabilities> {
    return this.withCtapClient(deviceId, (client) => client.getCapabilities());
  }

  async enroll(
    options: {
      deviceId?: string;
      label?: string;
      presence?: PreviewSignPresence;
    } = {},
  ): Promise<EnrollmentRecordV1> {
    return this.withCtapClient(options.deviceId, async (client) => {
      const capabilities = await client.getCapabilities();
      const generated = await client.generateKey(
        options.presence ?? PreviewSignPresence.RequireUserPresence,
      );
      const createdAt = this.now().toISOString();
      return {
        version: 'preview-sign.enrollment.v1',
        id: toBase64Url(
          sha256(
            concatBytes(
              generated.outerCredentialId,
              generated.previewKeyHandle,
              fromBase64Url(generated.seedPublicKey.encoded),
            ),
          ),
        ),
        createdAt,
        label: options.label,
        device: {
          id: capabilities.device.id,
          product: capabilities.device.product,
          manufacturer: capabilities.device.manufacturer,
          serialNumber: capabilities.device.serialNumber,
          vendorId: capabilities.device.vendorId,
          productId: capabilities.device.productId,
        },
        capabilities: {
          versions: capabilities.versions,
          extensions: capabilities.extensions,
          options: capabilities.options,
          aaguid: capabilities.aaguid,
          supportsPreviewSign: capabilities.supportsPreviewSign,
          supportsCtap23: capabilities.supportsCtap23,
        },
        outerCredentialId: toBase64Url(generated.outerCredentialId),
        outerPublicKey: generated.outerPublicKey,
        previewKeyHandle: toBase64Url(generated.previewKeyHandle),
        seedPublicKey: generated.seedPublicKey,
        algorithm: generated.algorithm,
        attestation: {
          format: generated.attestation.format,
          object: toBase64Url(generated.attestation.object),
          verified: generated.attestation.verified,
          trust: generated.attestation.trust,
        },
      };
    });
  }

  async signDigest(input: SignDigestInput): Promise<SignDigestResult> {
    invariant(
      input.digest.length === 32,
      'INVALID_INPUT',
      'Digest must be 32 bytes',
    );
    invariant(
      input.enrollment.attestation.verified ||
        input.allowUnverifiedEnrollment === true,
      'UNTRUSTED_ENROLLMENT',
      'Enrollment attestation is unverified; explicitly opt in only for a trusted local development enrollment',
      { enrollmentId: input.enrollment.id },
    );
    const ikm = input.ikm ?? new Uint8Array(randomBytes(32));
    const context = input.context ?? new Uint8Array(randomBytes(32));
    const derived = deriveArkgPublicKey(
      input.enrollment.seedPublicKey,
      ikm,
      context,
    );
    const signature = await this.withCtapClient(input.deviceId, (client) =>
      client.signByCredential({
        outerCredentialId: fromBase64Url(input.enrollment.outerCredentialId),
        outerPublicKey: input.enrollment.outerPublicKey,
        previewKeyHandle: fromBase64Url(input.enrollment.previewKeyHandle),
        toBeSigned: input.digest,
        additionalArguments: derived.additionalArguments,
        presence: input.presence,
      }),
    );
    invariant(
      verifyP256PrehashedSignature(input.digest, signature, derived.publicKey),
      'VERIFICATION_FAILED',
      'Authenticator returned a previewSign signature that did not self-verify',
    );
    return {
      signature,
      verificationKey: {
        version: 'preview-sign.verification-key.v1',
        id: toBase64Url(
          sha256(
            concatBytes(
              utf8(input.enrollment.id),
              fromBase64Url(derived.publicKey.x),
              fromBase64Url(derived.publicKey.y),
              ikm,
              context,
            ),
          ),
        ),
        enrollmentId: input.enrollment.id,
        createdAt: this.now().toISOString(),
        algorithm: -9,
        ikm: toBase64Url(ikm),
        context: toBase64Url(context),
        additionalArguments: toBase64Url(derived.additionalArguments),
        publicKey: derived.publicKey,
      },
    };
  }

  verifyDigest(input: {
    enrollment: EnrollmentRecordV1;
    verificationKey: VerificationKeyRecordV1;
    digest: Uint8Array;
    signature: Uint8Array;
  }): boolean {
    if (
      input.digest.length !== 32 ||
      input.verificationKey.enrollmentId !== input.enrollment.id
    ) {
      return false;
    }
    const derived = deriveArkgPublicKey(
      input.enrollment.seedPublicKey,
      fromBase64Url(input.verificationKey.ikm),
      fromBase64Url(input.verificationKey.context),
    );
    return (
      derived.publicKey.x === input.verificationKey.publicKey.x &&
      derived.publicKey.y === input.verificationKey.publicKey.y &&
      bytesEqual(
        derived.additionalArguments,
        fromBase64Url(input.verificationKey.additionalArguments),
      ) &&
      verifyP256PrehashedSignature(
        input.digest,
        input.signature,
        input.verificationKey.publicKey,
      )
    );
  }

  private async withCtapClient<T>(
    deviceId: string | undefined,
    task: (client: PreviewSignCtapClient) => Promise<T>,
  ): Promise<T> {
    const connection = this.connectOverride
      ? await this.connectOverride(deviceId)
      : await CtapHidTransport.open({ provider: this.provider, deviceId });
    try {
      return await task(
        new PreviewSignCtapClient(connection, {
          rpId: this.rpId,
          rpName: this.rpName,
        }),
      );
    } finally {
      await connection.close?.();
    }
  }
}
