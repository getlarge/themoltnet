/**
 * Generate SSH key test vectors for cross-platform verification.
 *
 * Takes 3 known Ed25519 seeds, computes public keys, and encodes them
 * in both MoltNet format (ed25519:<base64>) and SSH format
 * (ssh-ed25519 <base64-wire-blob>).
 *
 * Uses @noble/ed25519 (same library as MoltNet's crypto-service) to ensure
 * the vectors match exactly what the production code would produce.
 *
 * Usage: node test-fixtures/generate-ssh-vectors.mjs
 */

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

// Resolve @noble/ed25519 from the crypto-service workspace where it's installed
const require = createRequire(
  join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    'libs',
    'crypto-service',
    'package.json',
  ),
);
const ed = require('@noble/ed25519');

// Set up sha512Sync (required by @noble/ed25519)
ed.etc.sha512Sync = (...m) => {
  const hash = createHash('sha512');
  m.forEach((msg) => hash.update(msg));
  return hash.digest();
};

/**
 * Encode a 32-byte Ed25519 public key into SSH wire format.
 *
 * SSH wire format for ed25519:
 *   uint32(len("ssh-ed25519")) + "ssh-ed25519" + uint32(len(pubkey)) + pubkey
 *
 * The result is then base64-encoded to produce the string after "ssh-ed25519 ".
 */
function encodeSSHPublicKey(pubkeyBytes) {
  const keyType = 'ssh-ed25519';
  const keyTypeBytes = Buffer.from(keyType, 'ascii');

  // Build wire format: two length-prefixed strings
  const buf = Buffer.alloc(4 + keyTypeBytes.length + 4 + pubkeyBytes.length);
  let offset = 0;

  // Key type string
  buf.writeUInt32BE(keyTypeBytes.length, offset);
  offset += 4;
  keyTypeBytes.copy(buf, offset);
  offset += keyTypeBytes.length;

  // Public key bytes
  buf.writeUInt32BE(pubkeyBytes.length, offset);
  offset += 4;
  Buffer.from(pubkeyBytes).copy(buf, offset);

  return `ssh-ed25519 ${buf.toString('base64')}`;
}

// Define our 3 test seeds
const seeds = [
  {
    description: 'zero seed (all 0x00)',
    seed: Buffer.alloc(32, 0x00),
  },
  {
    description: 'sequential seed (0x01..0x20)',
    seed: Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1)),
  },
  {
    description: 'max seed (all 0xFF)',
    seed: Buffer.alloc(32, 0xff),
  },
];

// Generate vectors
const vectors = seeds.map(({ description, seed }) => {
  const pubkeyBytes = ed.getPublicKey(seed);
  const pubkeyBuf = Buffer.from(pubkeyBytes);

  return {
    description,
    seed_base64: seed.toString('base64'),
    public_key_moltnet: `ed25519:${pubkeyBuf.toString('base64')}`,
    public_key_ssh: encodeSSHPublicKey(pubkeyBuf),
  };
});

const output = { vectors };

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, 'ssh-key-vectors.json');
writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');

console.log(`Wrote ${vectors.length} vectors to ${outPath}`);
for (const v of vectors) {
  console.log(`  - ${v.description}`);
  console.log(`    seed:    ${v.seed_base64}`);
  console.log(`    moltnet: ${v.public_key_moltnet}`);
  console.log(`    ssh:     ${v.public_key_ssh}`);
}
