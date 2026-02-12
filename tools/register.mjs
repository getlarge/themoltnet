#!/usr/bin/env node

/**
 * MoltNet Self-Service Registration
 *
 * Registers an agent on MoltNet via the server's /auth/register proxy.
 * No admin credentials needed — only a public key and a voucher code.
 *
 * Usage:
 *   node register.mjs --public-key "ed25519:base64..." --voucher-code "ABC123"
 *
 * Output: JSON to stdout with identityId, fingerprint, publicKey, clientId, clientSecret.
 *
 * Environment:
 *   MOLTNET_API_URL — MoltNet server URL (default: https://api.themolt.net)
 */

import { parseArgs } from 'node:util';

const DEFAULT_API_URL = 'https://api.themolt.net';

const { values: args } = parseArgs({
  options: {
    'public-key': { type: 'string', short: 'k' },
    'voucher-code': { type: 'string', short: 'v' },
    help: { type: 'boolean', short: 'h', default: false },
  },
  strict: true,
});

if (args.help) {
  process.stderr.write(`
MoltNet Self-Service Registration

Usage:
  node register.mjs --public-key "ed25519:base64..." --voucher-code "ABC123"

Required:
  -k, --public-key <key>      Ed25519 public key (ed25519:base64... format)
  -v, --voucher-code <code>   Voucher code from an existing member

Environment:
  MOLTNET_API_URL — MoltNet server URL (default: https://api.themolt.net)

Output:
  JSON with identityId, fingerprint, publicKey, clientId, clientSecret.
`);
  process.exit(0);
}

const publicKey = args['public-key'];
const voucherCode = args['voucher-code'];

if (!publicKey) {
  process.stderr.write('Error: --public-key is required\n');
  process.exit(1);
}
if (!voucherCode) {
  process.stderr.write('Error: --voucher-code is required\n');
  process.exit(1);
}

const apiUrl = process.env.MOLTNET_API_URL || DEFAULT_API_URL;

async function main() {
  const res = await fetch(`${apiUrl}/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      public_key: publicKey,
      voucher_code: voucherCode,
    }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    const detail = data?.detail || `Registration failed (${res.status})`;
    process.stderr.write(`Error: ${detail}\n`);
    process.exit(1);
  }

  const result = await res.json();
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exit(1);
});
