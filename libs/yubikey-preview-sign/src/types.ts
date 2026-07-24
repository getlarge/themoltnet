import type { DeviceDescriptor, HidProvider } from '@themoltnet/ctap';

export { type DeviceDescriptor, type HidProvider };

export enum PreviewSignPresence {
  Unattended = 0,
  RequireUserPresence = 1,
  RequireUserVerification = 5,
}

export interface PreviewSignCapabilities {
  device: DeviceDescriptor;
  versions: string[];
  extensions: string[];
  options: Record<string, boolean>;
  aaguid?: string;
  supportsPreviewSign: boolean;
  supportsCtap23: boolean;
}

export interface CoseEc2PublicKey {
  kty: 2;
  algorithm: number;
  curve: 1;
  x: string;
  y: string;
}

export interface CoseArkgSeedPublicKey {
  kty: -65537;
  algorithm: -65700;
  derivedAlgorithm: -9;
  blindingKey: CoseEc2PublicKey;
  kemKey: CoseEc2PublicKey;
  encoded: string;
}

export interface EnrollmentRecordV1 {
  version: 'preview-sign.enrollment.v1';
  id: string;
  createdAt: string;
  label?: string;
  device: Omit<DeviceDescriptor, 'path'>;
  capabilities: Omit<PreviewSignCapabilities, 'device'>;
  outerCredentialId: string;
  outerPublicKey: CoseEc2PublicKey;
  previewKeyHandle: string;
  seedPublicKey: CoseArkgSeedPublicKey;
  algorithm: -65539;
  attestation: {
    format: string;
    object: string;
    verified: boolean;
    trust: 'self' | 'unverified';
  };
}

export interface VerificationKeyRecordV1 {
  version: 'preview-sign.verification-key.v1';
  id: string;
  enrollmentId: string;
  createdAt: string;
  algorithm: -9;
  ikm: string;
  context: string;
  additionalArguments: string;
  publicKey: CoseEc2PublicKey;
}
