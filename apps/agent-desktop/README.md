# MoltNet Agent desktop

The macOS and Ubuntu desktop app installs and supervises the pinned
`moltnet-agent` bundle over a private native socket and opens the browser for
OAuth PKCE approval when needed.

## Development

```bash
pnpm exec nx run @moltnet/agent-desktop:tauri:dev
```

The regular project checks cover React operation flows and native lifecycle,
updater signatures, rollback, shutdown, and the embedded Agent version contract:

```bash
pnpm exec nx run-many -t lint typecheck test build \
  --projects=@moltnet/agent-desktop
```

## Ubuntu packages

The initial Linux target is Ubuntu 24.04 LTS, x86-64. The `.deb` installs QEMU, GNOME Keyring, and system
GUI dependencies through Ubuntu’s package manager; AppImage users also need the Ubuntu WebKit/GTK runtime and
FUSE support (`libfuse2t64`). Neither format bundles the Agent CLI: Desktop
installs the same signed, pinned bundle used on macOS.

Server → System requirements inspects QEMU, the session's Secret Service, and
KVM access. Installing optional worker requirements and adding the current user
to the existing `kvm` group require separate confirmation and Ubuntu system
authorization. KVM group changes require signing out and back in. A running
Secret Service does not prove the keyring is unlocked; credential operations
may still request an unlock. Cancelling setup leaves existing configuration
available and does not enable an unsandboxed worker fallback.

For unsigned local packaging on Ubuntu:

```bash
pnpm exec nx run @moltnet/agent-desktop:tauri:bundle:linux
```

For unsigned macOS packaging use `@moltnet/agent-desktop:tauri:bundle:mac-os`.
Both targets use `--configuration=release` for signed release packaging.
Unsigned builds omit updater signatures so PR checks need no release secrets.

CI checks both platforms in the same package workflow. On Ubuntu it builds both packages, installs the `.deb`, checks shared-library resolution,
and launches each format under a virtual display. Release jobs verify signed
artifacts after upload and publish only after both macOS and Ubuntu packages
are complete. The combined updater manifest is therefore published only when
the macOS archive, Ubuntu `.deb`, and Ubuntu AppImage have all passed their
platform release jobs. A Linux packaging failure therefore blocks the macOS
release from being published. If finalization leaves a draft release, rerun
the failed workflow within seven days so it can reuse the verified platform
metadata; after that retention window, rerun both platform package jobs. The updater selects `linux-x86_64-deb` or
`linux-x86_64-appimage`; `.deb` updates use Ubuntu authorization and cancellation
does not trigger a fallback password dialog.

A socket-capable Agent CLI must be released before distributing this Desktop
version. Co-releases inject the newly published Agent CLI version; otherwise
update the reviewed embedded pin first.

## Release acceptance

Package smoke coverage does not replace a clean Ubuntu desktop walkthrough.
Before the Linux release and Console cutover, record results for both formats:

- Install and launch without a terminal; check tray and Server status.
- Decline setup, then approve QEMU installation and KVM access; sign out and
  back in and check readiness again.
- Register or attach an identity, approve enrollment through Console, and
  confirm credential storage and refreshed health. Repeat with a locked keyring.
- Configure a provider, run a real sandboxed worker, and read its logs.
- Restart Desktop and confirm identity, provider, and runtime persistence.
- Install a signed update of the same package format; exercise cancellation,
  interrupted Agent CLI installation, and rollback.
- Quit from the tray and confirm the supervised server and workers follow the
  selected shutdown behavior.

macOS UI automation is also a follow-up: component and Rust tests cover the
contracts, while a signed-app suite should exercise install, native connection,
updates, shutdown, and the other-process ownership boundary.
