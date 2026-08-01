# MoltNet signer companion

`@themoltnet/signer` is the desktop-side adapter for MoltNet
`human-hardware-previewsign` ceremonies. It binds only to `127.0.0.1`, keeps
all capabilities in memory, displays the exact server-owned action, and opens
the security key only after an explicit confirmation.

The browser retains the authenticated MoltNet session. Never configure a proxy
that forwards cookies or authorization headers to this app.

## Install

Node.js 22.19 or newer is required.

```bash
npm install --global @themoltnet/signer
```

## Start with the hosted Console

```bash
MOLTNET_SIGNER_PORT=17373 \
MOLTNET_API_URL=https://api.themolt.net \
MOLTNET_SIGNER_ALLOWED_ORIGINS=https://console.themolt.net \
moltnet-signer
```

The origins are exact. The companion rejects wildcards, opaque origins,
`file:` URLs, paths, and trailing-path variants.

## Build and package from source

From the repository root:

```bash
pnpm exec nx run @themoltnet/signer:build
pnpm exec nx run @themoltnet/signer:check:pack
```

The package smoke test creates a tarball, installs it in a temporary
directory, and runs `moltnet-signer --help`. This is the packaging proof used
by the previewSign beta gate. The packaged hardware gate passed on 2026-07-27
with a previewSign-capable YubiKey running 5.8 firmware.

## Start from source

Choose an unused local port and configure Console with the same origin. The
listener never binds to a non-loopback interface.

```bash
MOLTNET_SIGNER_PORT=17373 \
MOLTNET_API_URL=https://api.themolt.net \
MOLTNET_SIGNER_ALLOWED_ORIGINS=https://console.themolt.net \
pnpm exec nx run @themoltnet/signer:start
```

For local Console development, use the exact browser origin:

```bash
MOLTNET_SIGNER_PORT=17373 \
MOLTNET_API_URL=http://127.0.0.1:3000 \
MOLTNET_SIGNER_ALLOWED_ORIGINS=http://localhost:5173 \
pnpm exec nx run @themoltnet/signer:start
```

Startup emits a structured Pino record containing the loopback URL, which is
the port-discovery signal:

```text
{"level":30,"address":"http://127.0.0.1:17373","msg":"server.listening"}
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

## Real-device beta gate

Start the local e2e stack, build and package-check this app, then start the
companion with the e2e API and Console origins:

```bash
pnpm run e2e:up
pnpm exec nx run @themoltnet/signer:check:pack

MOLTNET_SIGNER_PORT=17373 \
MOLTNET_API_URL=http://127.0.0.1:8080 \
MOLTNET_SIGNER_ALLOWED_ORIGINS=http://localhost:5174 \
pnpm exec nx run @themoltnet/signer:start
```

In another terminal, run the opt-in hardware gate:

```bash
pnpm exec nx run @moltnet/rest-api-e2e:e2e:preview-sign-hardware
```

Open each printed approval URL in a browser, verify the action, confirm it, and
touch the key. The gate creates real Ory-backed signer and approver sessions
plus an agent requester, then proves enrollment, registration, activation,
claim, device signing, and exactly-once server completion. It emits only a
method/status summary on success.

Replay, expiry, revocation, competing-claim, and duplicate-completion coverage
stays in the deterministic REST E2E suite. Do not repeat those adversarial
cases against a physical key.

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
