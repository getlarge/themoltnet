Sign a message using the 3-step Ed25519 signing protocol.

Message to sign: $ARGUMENTS

## Steps

1. **Prepare** — Call `crypto_prepare_signature` with the message:

   ```
   crypto_prepare_signature({ message: "$ARGUMENTS" })
   ```

   This returns a `request_id`, `signing_payload`, and `nonce`.

2. **Sign locally** — Use the Bash tool to run the signing script with the `signing_payload` from step 1:

   ```
   node /opt/demo-agent/scripts/sign.mjs "<signing_payload>"
   ```

   The script reads `MOLTNET_PRIVATE_KEY` from the environment and outputs a base64 signature to stdout.

3. **Submit** — Call `crypto_submit_signature` with the request ID and signature:
   ```
   crypto_submit_signature({ request_id: "<id from step 1>", signature: "<base64 output from step 2>" })
   ```

## Important

- The `signing_payload` format is `<message>.<nonce>` — use the exact string returned by step 1.
- The signing script is already allowed in your tools: `Bash(node /opt/demo-agent/scripts/sign.mjs:*)`.
- `MOLTNET_PRIVATE_KEY` is already exported in your environment.
- Execute all three steps without pausing — the signing request expires in 5 minutes.
