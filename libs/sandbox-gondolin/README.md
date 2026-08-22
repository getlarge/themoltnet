# @themoltnet/sandbox-gondolin

Gondolin microVM sandbox lifecycle for MoltNet runtimes. This package sits
**below** any coding-agent runtime: `@themoltnet/pi-runtime` depends on it,
never the reverse, and it knows nothing about Pi, Claude, or Codex.

It was extracted verbatim from `@themoltnet/pi-runtime` (`vm-manager`,
`snapshot`, `abort-utils`, `path-containment`) so that a second sandbox
implementation can be added beside it without going through Pi.

## What it owns

- `resumeVm(config)` — resume a checkpoint into a live VM: workspace mount
  with VFS shadowing (`deny` / `tmpfs`), egress allowlist through Gondolin's
  host-side HTTP hooks, explicit guest environment, resource limits, resume
  commands, and abort-safe cleanup.
- The guest credential boundary: `guest-config` injects the complete
  `.moltnet/<agent>` tree; `host-authenticated` withholds it and refuses
  `MOLTNET_*` names in runtime-controlled guest environment
  (`assertGuestEnvironmentBoundary`).
- `VmConfig.brokeredSecrets` — host-brokered secrets: the guest sees a
  placeholder, Gondolin's `SecretManager` substitutes the value only in
  requests to the declared host patterns.
- `ensureSnapshot` — build and cache the base checkpoint.
- Small helpers: `findMainWorktree`, `isResolvedPathInsideRoot`,
  `abortableResource` / `throwIfAborted`.

## What it deliberately does not own

- **Provider authentication.** A runtime supplies `VmConfig.providerAuth`
  (`{ load(): string | null; guestPath }`); the sandbox only carries the blob
  across the boundary. Pi's `~/.pi/agent/auth.json` handling lives in
  `@themoltnet/pi-runtime` (`piProviderAuth`, and its `resumeVm` wrapper).
- Tool definitions, tool policy, task execution, workspace preparation —
  all Pi-runtime concerns.

## Known boundary facts

- Egress policy is hostname-granular: no scheme or port narrowing.
- Guest `127.0.0.1` / `localhost` never leave the VM; names are resolved on
  the host side by the proxy.
- Exec abort only drops the host session; a caller that needs the guest
  process gone must kill it in the guest.

Live tests (`vm-manager.integration.test.ts`) boot real VMs and run only with
`MOLTNET_PI_VM_INTEGRATION=1`; CI runs them in the agent-daemon Core lane.
