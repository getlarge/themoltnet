/**
 * SSHSIG envelope codec (PROTOCOL.sshsig).
 *
 * `ssh-keygen -Y sign` asks the signer to sign this envelope rather than the
 * raw message:
 *
 *   "SSHSIG" || string(namespace) || string(reserved) || string(hash_alg)
 *            || string(H(message))
 *
 * A signing broker parses the envelope so it can refuse anything but the
 * namespace it is meant to serve; it never signs arbitrary bytes.
 */
const MAGIC = new TextEncoder().encode('SSHSIG');
const DIGEST_LENGTHS: Record<string, number> = { sha256: 32, sha512: 64 };
const SSH_ED25519 = 'ssh-ed25519';

export class SshsigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SshsigError';
  }
}

export interface SshsigEnvelope {
  namespace: string;
  reserved: Uint8Array;
  hashAlgorithm: string;
  digest: Uint8Array;
}

/** Length-prefixed SSH string (uint32 big-endian length followed by bytes). */
export function encodeSshString(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + data.length);
  new DataView(out.buffer).setUint32(0, data.length);
  out.set(data, 4);
  return out;
}

export function readSshString(
  bytes: Uint8Array,
  offset: number,
): { value: Uint8Array; next: number } {
  if (offset + 4 > bytes.length) {
    throw new SshsigError('SSHSIG envelope truncated');
  }
  const len = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(offset);
  const start = offset + 4;
  if (start + len > bytes.length) {
    throw new SshsigError('SSHSIG envelope truncated');
  }
  return { value: bytes.subarray(start, start + len), next: start + len };
}

export function parseSshsigEnvelope(bytes: Uint8Array): SshsigEnvelope {
  if (
    bytes.length < MAGIC.length ||
    !MAGIC.every((byte, index) => bytes[index] === byte)
  ) {
    throw new SshsigError('SSHSIG magic missing');
  }
  let offset = MAGIC.length;
  const namespace = readSshString(bytes, offset);
  offset = namespace.next;
  const reserved = readSshString(bytes, offset);
  offset = reserved.next;
  const hash = readSshString(bytes, offset);
  offset = hash.next;
  const digest = readSshString(bytes, offset);
  offset = digest.next;
  if (offset !== bytes.length) {
    throw new SshsigError('SSHSIG envelope has trailing bytes');
  }
  const hashAlgorithm = new TextDecoder().decode(hash.value);
  const expected = DIGEST_LENGTHS[hashAlgorithm];
  if (expected === undefined) {
    throw new SshsigError(
      `SSHSIG hash algorithm "${hashAlgorithm}" unsupported`,
    );
  }
  if (digest.value.length !== expected) {
    throw new SshsigError(
      `SSHSIG digest length ${digest.value.length} does not match ${hashAlgorithm}`,
    );
  }
  return {
    namespace: new TextDecoder().decode(namespace.value),
    reserved: reserved.value,
    hashAlgorithm,
    digest: digest.value,
  };
}

/** Git commit/tag signatures use namespace `git`, empty reserved, sha512. */
export function assertGitSshsigEnvelope(env: SshsigEnvelope): void {
  if (env.namespace !== 'git') {
    throw new SshsigError(`SSHSIG namespace "${env.namespace}" is not "git"`);
  }
  if (env.reserved.length !== 0) {
    throw new SshsigError('SSHSIG reserved field must be empty');
  }
  if (env.hashAlgorithm !== 'sha512') {
    throw new SshsigError('SSHSIG git signatures must use sha512');
  }
}

/** Wrap a raw Ed25519 signature as the SSH wire signature blob. */
export function encodeSshEd25519Signature(raw: Uint8Array): Uint8Array {
  if (raw.length !== 64) {
    throw new SshsigError('ed25519 signature must be 64 bytes');
  }
  const type = encodeSshString(new TextEncoder().encode(SSH_ED25519));
  const signature = encodeSshString(raw);
  const out = new Uint8Array(type.length + signature.length);
  out.set(type, 0);
  out.set(signature, type.length);
  return out;
}
