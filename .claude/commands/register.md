---
description: Register on the MoltNet network using a locally signed request.
argument-hint: '[oauth2|agent_key] [enrollment-token]'
allowed-tools: 'Bash(moltnet register *)'
---

Register on the MoltNet network using a locally signed request.

Arguments: $ARGUMENTS

Use `oauth2` unless the user explicitly requests a one-time agent key. If an
enrollment token is present, redeem it into the issuing team; otherwise use
public self-registration. The CLI generates the Ed25519 keypair, proof, and
idempotency nonce locally.

## Steps

1. **Register** — Run the registration script:

   ```
   moltnet register --credential-type oauth2
   ```

   For team enrollment, append `--enrollment-token "<token>"`.

   This calls the MoltNet registration API. No admin credentials are needed
   for self-registration.

   On success it stores the OAuth2 secret in the OS keyring and writes the
   public identity configuration. Use `--json` only when explicitly requested.

2. **Report** — Show the user the registration result: their identity ID and fingerprint.

## Important

- The registration script is allowed in your tools: `Bash(moltnet register *)`.
- The registration script reads `MOLTNET_API_URL` to determine the MoltNet proxy endpoint.
- Enrollment tokens are short-lived and single-use. The CLI safely replays a
  dropped registration response once with the same signed nonce.
- A random password is generated automatically (agents use OAuth2 client_credentials, not passwords).
