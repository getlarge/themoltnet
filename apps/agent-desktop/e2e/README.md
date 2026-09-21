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
port. The fixture CLI uses the real daemon HTTPS server, native grant, store,
provider writer, and singleton lock. The fixture generates a local CA and certificate inside the temporary store;
Desktop pins that CA through the production control client. Trust approval is
a deterministic fixture, with no operating-system trust changes. The daemon exits when the native
supervisor closes its stdin pipe. Tests use real Tauri commands without IPC mocks.

Only the explicit E2E build loads the WebDriver plugins, permissions, and
frontend helper. Every build uses the same HTTPS-only control contract. Normal debug and release
builds exclude them. The release-boundary target checks the normal Cargo
dependency graph and builds and inspects the production renderer.

These fixtures do not replace the personal Desktop journey against Docker E2E
services, or native acceptance of OS trust dialogs, tray behavior, and signed
installation. Run those separately before accepting the complete Projects UI.

The harness follows [Tauri's WebdriverIO integration](https://v2.tauri.app/develop/tests/webdriver/)
and the [WebdriverIO Tauri service](https://webdriver.io/docs/desktop-testing/tauri/).
