/**
 * Cross-Language Signing Vector Tests
 *
 * Loads test-fixtures/crypto-vectors.json signing_vectors and verifies that
 * buildSigningBytes + signWithNonce/verifyWithNonce produce identical results
 * across JS and Go for adversarial payloads (multiline, Unicode, null bytes, etc.).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildSigningBytes, cryptoService } from '../src/crypto.service.js';

interface SigningVector {
  comment: string;
  message: string;
  nonce: string;
  signing_bytes_hex: string;
  signature_base64: string;
}

interface SigningVectorsSection {
  description: string;
  private_key_base64: string;
  public_key: string;
  vectors: SigningVector[];
}

const vectorsPath = resolve(
  import.meta.dirname,
  '../../../test-fixtures/crypto-vectors.json',
);
const parsed = JSON.parse(readFileSync(vectorsPath, 'utf-8'));
const signingVectors = parsed.signing_vectors as SigningVectorsSection;

describe('buildSigningBytes', () => {
  it('produces the expected byte layout (domain prefix + length-prefixed hash + nonce)', () => {
    const bytes = buildSigningBytes('hello', 'nonce123');
    // "moltnet:v1" = 10 bytes, u32be(32) = 4, SHA256 = 32, u32be(8) = 4, "nonce123" = 8
    expect(bytes.length).toBe(10 + 4 + 32 + 4 + 8);
  });

  it('starts with domain prefix "moltnet:v1"', () => {
    const bytes = buildSigningBytes('hello', 'nonce123');
    const prefix = new TextDecoder().decode(bytes.slice(0, 10));
    expect(prefix).toBe('moltnet:v1');
  });

  it('is deterministic for the same inputs', () => {
    const a = buildSigningBytes('test', 'nonce');
    const b = buildSigningBytes('test', 'nonce');
    expect(Buffer.from(a).toString('hex')).toBe(Buffer.from(b).toString('hex'));
  });

  it('differs for different messages', () => {
    const a = buildSigningBytes('msg1', 'nonce');
    const b = buildSigningBytes('msg2', 'nonce');
    expect(Buffer.from(a).toString('hex')).not.toBe(
      Buffer.from(b).toString('hex'),
    );
  });

  it('differs for different nonces', () => {
    const a = buildSigningBytes('msg', 'nonce1');
    const b = buildSigningBytes('msg', 'nonce2');
    expect(Buffer.from(a).toString('hex')).not.toBe(
      Buffer.from(b).toString('hex'),
    );
  });
});

describe('Cross-language signing vectors', () => {
  for (const [i, v] of signingVectors.vectors.entries()) {
    describe(`vector ${i + 1}: ${v.comment}`, () => {
      it('produces expected signing bytes', () => {
        const bytes = buildSigningBytes(v.message, v.nonce);
        const hex = Buffer.from(bytes).toString('hex');
        expect(hex).toBe(v.signing_bytes_hex);
      });

      it('produces expected signature via signWithNonce', async () => {
        const sig = await cryptoService.signWithNonce(
          v.message,
          v.nonce,
          signingVectors.private_key_base64,
        );
        expect(sig).toBe(v.signature_base64);
      });

      it('verifies the expected signature via verifyWithNonce', async () => {
        const valid = await cryptoService.verifyWithNonce(
          v.message,
          v.nonce,
          v.signature_base64,
          signingVectors.public_key,
        );
        expect(valid).toBe(true);
      });

      it('rejects tampered message', async () => {
        const valid = await cryptoService.verifyWithNonce(
          v.message + 'x',
          v.nonce,
          v.signature_base64,
          signingVectors.public_key,
        );
        expect(valid).toBe(false);
      });

      it('rejects tampered nonce', async () => {
        const valid = await cryptoService.verifyWithNonce(
          v.message,
          v.nonce + 'x',
          v.signature_base64,
          signingVectors.public_key,
        );
        expect(valid).toBe(false);
      });
    });
  }
});

describe('signWithNonce / verifyWithNonce round-trip', () => {
  it('signs and verifies a multiline message', async () => {
    const kp = await cryptoService.generateKeyPair();
    const message = 'line1\nline2\nline3';
    const nonce = 'test-nonce-uuid';

    const sig = await cryptoService.signWithNonce(
      message,
      nonce,
      kp.privateKey,
    );
    const valid = await cryptoService.verifyWithNonce(
      message,
      nonce,
      sig,
      kp.publicKey,
    );
    expect(valid).toBe(true);
  });

  it('rejects wrong public key', async () => {
    const kp1 = await cryptoService.generateKeyPair();
    const kp2 = await cryptoService.generateKeyPair();
    const sig = await cryptoService.signWithNonce(
      'msg',
      'nonce',
      kp1.privateKey,
    );
    const valid = await cryptoService.verifyWithNonce(
      'msg',
      'nonce',
      sig,
      kp2.publicKey,
    );
    expect(valid).toBe(false);
  });
});
