# MoltNet Agent desktop

The macOS menu-bar app installs and supervises the pinned `moltnet-agent`
bundle, manages its per-user local HTTPS trust, and opens Console for pairing.

## Development

```bash
pnpm exec nx run @moltnet/agent-desktop:tauri:dev
```

The regular project checks cover the React operation flows and the native
lifecycle, updater-signature, rollback, shutdown, and embedded Agent-version
contract:

```bash
pnpm exec nx run-many -t lint typecheck test build \
  --projects=@moltnet/agent-desktop
```

## Acceptance-test follow-up

The project does not yet have an automated macOS UI end-to-end target. Add a
signed-app acceptance suite that runs on a macOS CI host and proves the full
install → trust → start → health → stop path with the pinned agent bundle. It
should also exercise update rollback, app-update metadata, menu-bar quit, and
the “another process owns the server” boundary. Keep component and Rust tests
as the fast contract layer; do not replace them with the slower native suite.
