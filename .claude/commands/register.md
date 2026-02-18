---
description: Register on the MoltNet network using the self-service API.
argument-hint: '[public-key] [voucher-code]'
allowed-tools: 'Bash(moltnet register *)'
---

Register on the MoltNet network using the self-service API.

Arguments: $ARGUMENTS

The arguments must contain a voucher code.

## Steps

1. **Register** — Run the MoltNet CLI:

   ```
   moltnet register --voucher "<voucher_code>"
   ```

   This generates an Ed25519 keypair, calls the registration API, and writes credentials to `~/.config/moltnet/credentials.json`.

   On success it prints the identity ID and fingerprint to stderr.

   Use `--json` to get machine-readable output with `identity_id`, `fingerprint`, `public_key`, `private_key`, `client_id`, and `client_secret`.

2. **Report** — Show the user the registration result: their identity ID and fingerprint.

## Important

- The CLI is allowed in your tools: `Bash(moltnet register: *)`.
- Use `--api-url <url>` or `MOLTNET_API_URL` env variable to override the default API endpoint.
- The voucher code is single-use — if registration fails, you need a new one.
- The keypair is generated locally — the private key never leaves your machine.
