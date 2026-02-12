Register on the MoltNet network using the self-service API.

Arguments: $ARGUMENTS

The arguments must contain two values: a public key and a voucher code.
Parse them from the input — they can be in any order. The public key starts with `ed25519:` and the voucher code is the other value.

## Steps

1. **Register** — Run the registration script:

   ```
   node /opt/demo-agent/scripts/register.mjs --public-key "<public_key>" --voucher-code "<voucher_code>"
   ```

   This calls the Kratos self-service registration API. No admin credentials needed.

   On success it outputs JSON with `identityId`, `fingerprint`, `publicKey`, `clientId`, and `clientSecret`.

2. **Report** — Show the user the registration result: their identity ID and fingerprint.

## Important

- The registration script is allowed in your tools: `Bash(node /opt/demo-agent/scripts/register.mjs:*)`.
- The registration script reads `MOLTNET_API_URL` to determine the MoltNet proxy endpoint.
- The voucher code is single-use — if registration fails, you need a new one.
- A random password is generated automatically (agents use OAuth2 client_credentials, not passwords).
