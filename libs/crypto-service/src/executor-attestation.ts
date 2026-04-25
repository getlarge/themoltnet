import { createHash } from 'node:crypto';

import * as ed from '@noble/ed25519';
import { CID } from 'multiformats/cid';
import * as raw from 'multiformats/codecs/raw';
import { create } from 'multiformats/hashes/digest';

import { canonicalJson, canonicalJsonBytes } from './canonical-json.js';

ed.etc.sha512Sync = (...m) => {
  const hash = createHash('sha512');
  m.forEach((msg) => hash.update(msg));
  return hash.digest();
};

const SHA2_256_CODE = 0x12;
export const EXECUTOR_MANIFEST_SCHEMA_VERSION = 'moltnet:executor-manifest:v1';
export const EXECUTOR_ATTESTATION_PAYLOAD_VERSION =
  'moltnet:task-executor-attestation:v1';
export const EXECUTOR_ATTESTATION_DOMAIN =
  'moltnet-task-executor-attestation-v1';

export type ExecutorTrustLevel =
  | 'selfDeclared'
  | 'agentSigned'
  | 'releaseVerifiedTool'
  | 'sandboxAttested';

export interface ExecutorClaimAttestationPayload {
  v: typeof EXECUTOR_ATTESTATION_PAYLOAD_VERSION;
  phase: 'claim';
  taskId: string;
  executorFingerprint: string;
}

export interface ExecutorCompleteAttestationPayload {
  v: typeof EXECUTOR_ATTESTATION_PAYLOAD_VERSION;
  phase: 'complete';
  taskId: string;
  attemptN: number;
  outputCid: string;
  executorFingerprint: string;
}

export type ExecutorAttestationPayload =
  | ExecutorClaimAttestationPayload
  | ExecutorCompleteAttestationPayload;

export function buildExecutorClaimAttestationPayload(input: {
  taskId: string;
  executorFingerprint: string;
}): ExecutorClaimAttestationPayload {
  return {
    v: EXECUTOR_ATTESTATION_PAYLOAD_VERSION,
    phase: 'claim',
    taskId: input.taskId,
    executorFingerprint: input.executorFingerprint,
  };
}

export function buildExecutorCompleteAttestationPayload(input: {
  taskId: string;
  attemptN: number;
  outputCid: string;
  executorFingerprint: string;
}): ExecutorCompleteAttestationPayload {
  return {
    v: EXECUTOR_ATTESTATION_PAYLOAD_VERSION,
    phase: 'complete',
    taskId: input.taskId,
    attemptN: input.attemptN,
    outputCid: input.outputCid,
    executorFingerprint: input.executorFingerprint,
  };
}

export function canonicalizeExecutorAttestationPayload(
  payload: ExecutorAttestationPayload,
): string {
  return canonicalJson(payload);
}

export function buildExecutorAttestationSigningBytes(
  payload: ExecutorAttestationPayload,
): Uint8Array {
  const canonical = canonicalJsonBytes(payload);
  const payloadHash = createHash('sha256').update(canonical).digest();
  const domainBytes = Buffer.from(EXECUTOR_ATTESTATION_DOMAIN, 'utf8');
  const buf = Buffer.alloc(domainBytes.length + 4 + payloadHash.length);

  let offset = 0;
  domainBytes.copy(buf, offset);
  offset += domainBytes.length;
  buf.writeUInt32BE(payloadHash.length, offset);
  offset += 4;
  payloadHash.copy(buf, offset);

  return new Uint8Array(buf);
}

export async function signExecutorAttestation(
  payload: ExecutorAttestationPayload,
  privateKeyBase64: string,
): Promise<string> {
  const privateKeyBytes = new Uint8Array(
    Buffer.from(privateKeyBase64, 'base64'),
  );
  const signature = await ed.signAsync(
    buildExecutorAttestationSigningBytes(payload),
    privateKeyBytes,
  );
  return Buffer.from(signature).toString('base64');
}

export async function verifyExecutorAttestation(
  payload: ExecutorAttestationPayload,
  signature: string,
  publicKey: string,
): Promise<boolean> {
  try {
    const publicKeyBytes = new Uint8Array(
      Buffer.from(publicKey.replace(/^ed25519:/, ''), 'base64'),
    );
    const signatureBytes = new Uint8Array(Buffer.from(signature, 'base64'));
    return await ed.verifyAsync(
      signatureBytes,
      buildExecutorAttestationSigningBytes(payload),
      publicKeyBytes,
    );
  } catch {
    return false;
  }
}

export function computeExecutorManifestCid(manifest: unknown): string {
  assertExecutorManifestObject(manifest);
  const canonical = canonicalJsonBytes(manifest);
  const hash = createHash('sha256').update(canonical).digest();
  const digest = create(SHA2_256_CODE, hash);
  return CID.createV1(raw.code, digest).toString();
}

export function assertExecutorManifestObject(
  manifest: unknown,
): asserts manifest is Record<string, unknown> {
  if (
    manifest === null ||
    typeof manifest !== 'object' ||
    Array.isArray(manifest)
  ) {
    throw new Error('executorManifest must be a non-null JSON object');
  }
}
