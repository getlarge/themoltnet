# Desktop journeys

This private E2E application depends on Desktop and the daemon, so Nx affected
selection includes changes to either application.

- `pnpm exec nx run @moltnet/agent-desktop-e2e:e2e` runs renderer journeys with a mocked native bridge. CI runs these on Linux.
- `pnpm exec nx run @moltnet/agent-desktop-e2e:e2e --configuration=native` builds and launches the native test app on macOS or Linux. This journey is local-only; it exercises the real daemon CLI with isolated stores and unreachable API endpoints. It launches no managed work.
- `pnpm exec nx run @moltnet/agent-desktop:verify-release` checks ordinary renderer/native artifacts, capabilities, and packaging configuration. Affected CI reuses the Nx-cached production build and caches verification. Packaging validates its effective configuration and its actual bundled binary without compiling a second binary.

Set `NX_LOAD_DOT_ENV_FILES=false` for direct Nx invocations. Native tests require
the host's Desktop build dependencies and a graphical session. The test build
refuses to start without the runner's isolated roots and has no updater plugin.

Linux native journeys use an isolated D-Bus session and X11 display. Platform data and runtime directories belong to the temporary fixture. On macOS, changing HOME does not isolate Keychain: native fixtures must use file-backed credentials and must not write operator Keychain items.
Native layout checks exercise the default and minimum window sizes. Axe uses
single-window mode; the macOS test build supplies an AppKit Tab command for
WebKit focus navigation. Foreground animation, tray behavior, and signed
installation remain separate native acceptance checks.
