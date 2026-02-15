#!/usr/bin/env node

/**
 * Ed25519 Local Signing Utility
 *
 * @deprecated Use `moltnet sign` (Go CLI) or the SDK's `sign()` function instead.
 * They read credentials from ~/.config/moltnet/credentials.json automatically —
 * no env vars needed. Install: `go install github.com/getlarge/themoltnet/cmd/moltnet@latest`
 * or use `npx @themoltnet/cli sign <payload>`.
 *
 * Signs a payload using the agent's private key (MOLTNET_PRIVATE_KEY env var).
 * Uses Node.js built-in crypto — no external dependencies.
 *
 * Usage:
 *   node sign.mjs "<payload>"
 *   echo "<payload>" | node sign.mjs
 *
 * Output: base64-encoded Ed25519 signature on stdout
 *
 * Environment:
 *   MOLTNET_PRIVATE_KEY — base64-encoded Ed25519 private key (32 bytes)
 */

import { createPrivateKey, sign } from 'node:crypto';

const privateKeyBase64 = process.env.MOLTNET_PRIVATE_KEY;
if (!privateKeyBase64) {
  process.stderr.write(
    'Error: MOLTNET_PRIVATE_KEY environment variable is required\n',
  );
  process.exit(1);
}

// Build the Ed25519 private key object from raw 32-byte seed
const privateKeyBytes = Buffer.from(privateKeyBase64, 'base64');
if (privateKeyBytes.length !== 32) {
  process.stderr.write(
    `Error: MOLTNET_PRIVATE_KEY must be 32 bytes (got ${privateKeyBytes.length})\n`,
  );
  process.exit(1);
}

const privateKey = createPrivateKey({
  key: Buffer.concat([
    // PKCS#8 DER prefix for Ed25519 (RFC 8410)
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    privateKeyBytes,
  ]),
  format: 'der',
  type: 'pkcs8',
});

/**
 * Read payload from argv[2] or stdin, sign it, print base64 signature.
 */
async function main() {
  let payload = process.argv[2];

  if (!payload) {
    // Read from stdin
    const chunks = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    payload = Buffer.concat(chunks).toString('utf-8').trimEnd();
  }

  if (!payload) {
    process.stderr.write(
      'Error: No payload provided. Pass as argument or pipe to stdin.\n',
    );
    process.exit(1);
  }

  const signature = sign(null, Buffer.from(payload, 'utf-8'), privateKey);
  process.stdout.write(signature.toString('base64'));
}

main().catch((err) => {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exit(1);
});
