# Desktop automation

Run from the repository root with `NX_LOAD_DOT_ENV_FILES=false`:

```sh
pnpm exec nx run @moltnet/agent-desktop:e2e:chrome
pnpm exec nx run @moltnet/agent-desktop:e2e:native
pnpm exec nx run @moltnet/agent-desktop:e2e:typecheck
pnpm exec nx run @moltnet/agent-desktop:e2e:verify-release
```

Chrome starts its own Vite server on an available port. Native commands are
mocked before React mounts. Each WebDriver session has a fresh browser profile.

The macOS native target builds a separately identified app with the explicit
`desktop-e2e` Cargo feature and E2E Tauri configuration. Its parent launcher
creates temporary store and installation roots before WebDriver starts the app,
removes the inherited terminal bundle identity, and selects an available driver
port. The fixture CLI uses the real daemon HTTP server, native grant, store,
provider writer, and singleton lock. Trust responses are deterministic fixtures;
no operating-system trust changes occur. The daemon exits when the native
supervisor closes its stdin pipe. Tests use real Tauri commands without IPC mocks.

Only the explicit E2E build accepts loopback HTTP fixture discovery and loads the
WebDriver plugins, permissions, and frontend helper. Normal debug and release
builds exclude them. The release-boundary target checks the normal Cargo
dependency graph and builds and inspects the production renderer.

These fixtures do not replace the personal Desktop journey against Docker E2E
services, or native acceptance of OS trust dialogs, tray behavior, and signed
installation. Run those separately before accepting the complete Projects UI.

The harness follows [Tauri's WebdriverIO integration](https://v2.tauri.app/develop/tests/webdriver/)
and the [WebdriverIO Tauri service](https://webdriver.io/docs/desktop-testing/tauri/).
