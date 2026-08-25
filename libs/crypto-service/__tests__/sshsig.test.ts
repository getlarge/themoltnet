import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  assertGitSshsigEnvelope,
  encodeSshEd25519Signature,
  parseSshsigEnvelope,
  SshsigError,
} from '../src/sshsig.js';

interface Vectors {
  valid: {
    name: string;
    envelopeBase64: string;
    namespace: string;
    hashAlgorithm: string;
  }[];
  invalid: { name: string; envelopeBase64: string; error: string }[];
  gitRejected: { name: string; envelopeBase64: string; error: string }[];
}

// Fixture generated with:
// node -e 'const s=(x)=>{const b=Buffer.from(x);const l=Buffer.alloc(4);l.writeUInt32BE(b.length);return Buffer.concat([l,b])};
//   console.log(Buffer.concat([Buffer.from("SSHSIG"),s("git"),s(""),s("sha512"),s(Buffer.alloc(64))]).toString("base64"))'
const vectors = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, '../../../test-fixtures/sshsig-vectors.json'),
    'utf8',
  ),
) as Vectors;

describe('parseSshsigEnvelope', () => {
  it.each(vectors.valid)(
    'parses $name',
    ({ envelopeBase64, namespace, hashAlgorithm }) => {
      const env = parseSshsigEnvelope(Buffer.from(envelopeBase64, 'base64'));
      expect(env.namespace).toBe(namespace);
      expect(env.hashAlgorithm).toBe(hashAlgorithm);
      expect(env.digest.length).toBe(hashAlgorithm === 'sha256' ? 32 : 64);
    },
  );

  it.each(vectors.invalid)('rejects $name', ({ envelopeBase64, error }) => {
    expect(() =>
      parseSshsigEnvelope(Buffer.from(envelopeBase64, 'base64')),
    ).toThrow(new SshsigError(error));
  });
});

describe('assertGitSshsigEnvelope', () => {
  it('rejects a non-git namespace', () => {
    const env = parseSshsigEnvelope(
      Buffer.from(vectors.valid[1]!.envelopeBase64, 'base64'),
    );
    expect(() => assertGitSshsigEnvelope(env)).toThrow(
      /namespace "file" is not "git"/,
    );
  });

  it.each(vectors.gitRejected)(
    'rejects $name as a git signature envelope',
    ({ envelopeBase64, error }) => {
      const env = parseSshsigEnvelope(Buffer.from(envelopeBase64, 'base64'));
      expect(() => assertGitSshsigEnvelope(env)).toThrow(
        new SshsigError(error),
      );
    },
  );

  it('accepts the git namespace with sha512', () => {
    const env = parseSshsigEnvelope(
      Buffer.from(vectors.valid[0]!.envelopeBase64, 'base64'),
    );
    expect(() => assertGitSshsigEnvelope(env)).not.toThrow();
  });
});

describe('encodeSshEd25519Signature', () => {
  it('wraps a raw 64-byte signature as an ssh-ed25519 blob', () => {
    const raw = new Uint8Array(64).fill(7);
    const blob = encodeSshEd25519Signature(raw);
    expect(blob.length).toBe(4 + 11 + 4 + 64);
    expect(Buffer.from(blob.subarray(4, 15)).toString()).toBe('ssh-ed25519');
    expect(blob.subarray(19)).toEqual(raw);
  });

  it('rejects signatures that are not 64 bytes', () => {
    expect(() => encodeSshEd25519Signature(new Uint8Array(63))).toThrow(
      SshsigError,
    );
  });
});
