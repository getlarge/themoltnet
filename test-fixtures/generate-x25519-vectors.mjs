/**
 * Generate X25519 key derivation and encryption test vectors
 * for cross-language verification (JS ↔ Go).
 *
 * Uses the same @noble/curves, @noble/ciphers, @noble/hashes libraries
 * as the production encrypt.ts module.
 *
 * Usage: node test-fixtures/generate-x25519-vectors.mjs
 */

import { createHash, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

// Resolve noble libraries from the SDK workspace
const sdkRequire = createRequire(
  join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    'libs',
    'sdk',
    'package.json',
  ),
);

const cryptoRequire = createRequire(
  join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    'libs',
    'crypto-service',
    'package.json',
  ),
);

// Set up @noble/ed25519 sha512Sync
const ed = cryptoRequire('@noble/ed25519');
ed.etc.sha512Sync = (...m) => {
  const hash = createHash('sha512');
  m.forEach((msg) => hash.update(msg));
  return hash.digest();
};

// Resolve from crypto-service which has @noble/curves as a direct dep
const curvesPath = cryptoRequire.resolve('@noble/curves/ed25519.js');
const { ed25519: ed25519Curve, x25519 } = await import(curvesPath);
const { xchacha20poly1305 } = await import(
  sdkRequire.resolve('@noble/ciphers/chacha')
);
const { hkdf } = await import(sdkRequire.resolve('@noble/hashes/hkdf'));
const { sha256 } = await import(sdkRequire.resolve('@noble/hashes/sha2'));

const HKDF_INFO = 'moltnet:seal:v1';

// Use the two known seeds from crypto-vectors.json
const seeds = [
  {
    comment: 'Vector 1 from crypto-vectors.json',
    seed_base64: 'nWGxne/9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A=',
    public_key: 'ed25519:11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo=',
  },
  {
    comment: 'Vector 2 from crypto-vectors.json',
    seed_base64: 'TM0Imyj/ltqdtsNG7BFOD1uKMZ81q6Yk2oz27U+4pvs=',
    public_key: 'ed25519:PUAXw+hDiVqStwqnTRt+vJyYLM8uxJaMwM1V8Sr0Zgw=',
  },
];

// Generate X25519 derivation vectors
const x25519Vectors = seeds.map(({ comment, seed_base64, public_key }) => {
  const seed = Buffer.from(seed_base64, 'base64');
  const edPubB64 = public_key.replace('ed25519:', '');
  const edPubBytes = Buffer.from(edPubB64, 'base64');

  // Derive X25519 private key (same as crypto-service)
  const x25519Priv = ed25519Curve.utils.toMontgomerySecret(
    new Uint8Array(seed),
  );
  const x25519PrivB64 = Buffer.from(x25519Priv).toString('base64');

  // Derive X25519 public key (same as crypto-service)
  const x25519Pub = ed25519Curve.utils.toMontgomery(
    new Uint8Array(edPubBytes),
  );
  const x25519PubB64 = Buffer.from(x25519Pub).toString('base64');

  // Also compute public from private to verify consistency
  const x25519PubFromPriv = x25519.getPublicKey(x25519Priv);
  if (
    Buffer.from(x25519PubFromPriv).toString('base64') !== x25519PubB64
  ) {
    throw new Error(
      `X25519 public key mismatch for ${comment}: derived from Ed25519 public key vs computed from X25519 private key`,
    );
  }

  return {
    comment,
    ed25519_seed_base64: seed_base64,
    ed25519_public_key: public_key,
    x25519_private_key_base64: x25519PrivB64,
    x25519_public_key_base64: x25519PubB64,
  };
});

// Generate encryption vectors using deterministic ephemeral keys and nonces.
// We use fixed values so both JS and Go can reproduce the exact ciphertext.
const encryptionVectors = [];

// Alice = vector 1, Bob = vector 2
const alice = x25519Vectors[0];
const bob = x25519Vectors[1];

const testCases = [
  { comment: 'Simple ASCII message', plaintext: 'hello bob' },
  { comment: 'Empty string', plaintext: '' },
  { comment: 'Unicode: emoji and CJK', plaintext: 'こんにちは 🔑' },
  {
    comment: 'Multiline with null byte',
    plaintext: 'line1\nline2\x00line3',
  },
];

// Use a deterministic "ephemeral" seed for reproducibility.
// In production, ephemeral keys are random — these are fixed for testing.
const deterministicEphSeeds = [
  Buffer.from(
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'hex',
  ),
  Buffer.from(
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    'hex',
  ),
  Buffer.from(
    'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    'hex',
  ),
  Buffer.from(
    'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    'hex',
  ),
];

const deterministicNonces = [
  Buffer.alloc(24, 0x01),
  Buffer.alloc(24, 0x02),
  Buffer.alloc(24, 0x03),
  Buffer.alloc(24, 0x04),
];

for (let i = 0; i < testCases.length; i++) {
  const { comment, plaintext } = testCases[i];
  const ephSeed = deterministicEphSeeds[i];
  const nonce = deterministicNonces[i];

  // x25519.getPublicKey expects a Uint8Array scalar
  const ephSeedBytes = new Uint8Array(ephSeed);
  const ephPub = x25519.getPublicKey(ephSeedBytes);

  const recipientX25519PubBytes = Buffer.from(
    bob.x25519_public_key_base64,
    'base64',
  );

  // ECDH
  const shared = x25519.getSharedSecret(ephSeedBytes, recipientX25519PubBytes);

  // HKDF
  const key = hkdf(sha256, shared, undefined, HKDF_INFO, 32);

  // Encrypt
  const plaintextBytes = new TextEncoder().encode(plaintext);
  const cipher = xchacha20poly1305(key, nonce);
  const ciphertext = cipher.encrypt(plaintextBytes);

  encryptionVectors.push({
    comment,
    plaintext,
    recipient_ed25519_public_key: bob.ed25519_public_key,
    recipient_x25519_public_key_base64: bob.x25519_public_key_base64,
    ephemeral_seed_hex: ephSeed.toString('hex'),
    ephemeral_public_key_base64: Buffer.from(ephPub).toString('base64'),
    nonce_base64: nonce.toString('base64'),
    shared_secret_hex: Buffer.from(shared).toString('hex'),
    derived_key_hex: Buffer.from(key).toString('hex'),
    ciphertext_base64: Buffer.from(ciphertext).toString('base64'),
    sealed_envelope: {
      v: 1,
      ephemeral_public_key: Buffer.from(ephPub).toString('base64'),
      nonce: nonce.toString('base64'),
      ciphertext: Buffer.from(ciphertext).toString('base64'),
      algorithm: 'x25519-xchachapoly',
    },
    decryptor_ed25519_seed_base64: bob.ed25519_seed_base64,
    decryptor_x25519_private_key_base64: bob.x25519_private_key_base64,
  });
}

const output = {
  description:
    'Cross-language X25519 key derivation and sealed envelope encryption vectors',
  x25519_derivation: {
    description:
      'Ed25519 seed/pubkey → X25519 private/public key derivation via Edwards→Montgomery birational map',
    vectors: x25519Vectors,
  },
  encryption: {
    description:
      'Sealed envelope encryption: ephemeral X25519 ECDH + HKDF-SHA256 + XChaCha20-Poly1305. Uses deterministic ephemeral keys and nonces for reproducibility.',
    hkdf_info: HKDF_INFO,
    vectors: encryptionVectors,
  },
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, 'x25519-vectors.json');
writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');

console.log(`Wrote vectors to ${outPath}`);
console.log(`  ${x25519Vectors.length} X25519 derivation vectors`);
console.log(`  ${encryptionVectors.length} encryption vectors`);
