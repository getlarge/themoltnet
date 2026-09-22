# MoltNet Agent desktop

The macOS and Ubuntu desktop app installs and supervises a compatible signed
`moltnet-agent` bundle over a private native socket and opens the browser for
OAuth PKCE approval when needed.

## Projects and runs

Projects lists the shared projects available to an identity and team. Shared
administration opens Console. On this computer, add named local locations with
an explicit folder and workspace default. Removing a location removes only its
registration; its files stay in place.

In Runs, choose a project or General work, then a local location and runtime
profile. The composer shows the effective diary, folder, and workspace behavior.
Advanced overrides apply to this run. Save preset or Update preset explicitly
to retain them in a preset. Starting a run never saves edits automatically.
Setup navigation preserves the draft, and Run again prefills the captured
selection before revalidating it. History retains each run's captured workspace.

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
pnpm exec nx run @moltnet/agent-desktop:tauri:bundle --configuration=linux
```

For unsigned macOS packaging use `--configuration=mac-os`. Signed packaging
uses the same platform configurations with a trailing `-- release` mode
argument.
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

A compatible Agent Daemon must be released before distributing this Desktop
version. The release resolver selects the co-released version when present or
the newest published version that satisfies `agent-cli.minimum-version`.
Linux release smoke installs that exact published, signed daemon before it
launches the packaged Desktop; source-built bundles are reserved for PR package
checks.

## Release acceptance

Package smoke coverage does not replace a clean Ubuntu desktop walkthrough.
Before the Linux release, record results for both formats:

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

## Acceptance tests

The [Desktop automation harness](../agent-desktop-e2e/README.md) covers Chrome renderer journeys
and native macOS flows against an isolated fixture daemon, plus the personal
Desktop journey against Docker E2E services. Component and Rust tests cover the
fast contracts. Signed installation, native folder dialogs,
and tray behavior have separate native acceptance checks.
