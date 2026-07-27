# MoltNet signer companion

`apps/moltnet-signer` is the private desktop-side adapter for MoltNet
`human-hardware-previewsign` ceremonies. It binds only to `127.0.0.1`, keeps
all capabilities in memory, displays the exact server-owned action, and opens
the security key only after an explicit confirmation.

The browser retains the authenticated MoltNet session. Never configure a proxy
that forwards cookies or authorization headers to this app.

## Build and package

From the repository root:

```bash
pnpm exec nx run @moltnet/signer:build
pnpm exec nx run @moltnet/signer:check:pack
```

The package smoke test creates a private tarball, installs it in a temporary
directory, and runs `moltnet-signer --help`. The app remains private and is not
published to npm.

## Start

Choose an unused local port and configure Console with the same origin. The
listener never binds to a non-loopback interface.

```bash
MOLTNET_SIGNER_PORT=17373 \
MOLTNET_API_URL=https://api.themolt.net \
MOLTNET_SIGNER_ALLOWED_ORIGINS=https://console.themolt.net \
node apps/moltnet-signer/dist/main.js
```

For local Console development, use the exact browser origin:

```bash
MOLTNET_SIGNER_PORT=17373 \
MOLTNET_API_URL=http://127.0.0.1:3000 \
MOLTNET_SIGNER_ALLOWED_ORIGINS=http://localhost:5173 \
node apps/moltnet-signer/dist/main.js
```

Startup prints the loopback URL, which is the port-discovery signal:

```text
MoltNet signer listening on http://127.0.0.1:17373
```

Set Console's `SIGNER_URL` (container/runtime config) or
`VITE_SIGNER_URL` (local build config) to that exact URL. Origins are exact:
wildcards, opaque origins, `file:` URLs, paths, and trailing-path variants are
rejected.

Stop the companion with `Ctrl-C` or `SIGTERM`. It closes the listener and
discards all sessions, capability tokens, pending ceremonies, and receipts.
Nothing is persisted locally.

## Device access

- Use a previewSign-capable YubiKey with compatible 5.8 firmware.
- On macOS, allow the terminal or service host to access USB security devices
  if the OS prompts.
- On Linux, install an appropriate FIDO/hidraw udev rule for the device and
  ensure the current user can open it. Do not run the companion as root as a
  substitute for device permissions.
- Connect exactly one compatible key. The companion refuses zero or multiple
  eligible keys instead of guessing.

The companion does not accept arbitrary bytes. It revalidates the complete
challenge with the trusted API immediately before HID access and passes the
server's exact 32-byte digest and ARKG arguments to previewSign.

## Troubleshooting

- **Companion unavailable:** confirm the printed URL matches Console's signer
  URL and that the process is still running.
- **Origin is not allowed:** copy the browser's exact origin into
  `MOLTNET_SIGNER_ALLOWED_ORIGINS`; do not add a wildcard.
- **Server rejected the signing challenge:** refresh Console. The request may
  have expired, completed, changed lifecycle state, or lost an active
  credential.
- **Connect one key:** disconnect extra authenticators or connect one
  previewSign-capable key.
- **Permission denied / no devices on Linux:** fix hidraw/udev access, sign out
  and back in if group membership changed, then restart the companion.

Do not log raw requests, HID frames, browser credentials, or device-private
material while diagnosing failures.
