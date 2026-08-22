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

## Brokered HTTP secrets

`brokeredSecrets` is trusted-host input to `resumeVm`; it is deliberately not
part of `SandboxConfig`. A remotely stored runtime profile may constrain
network access and refer to a logical credential requirement, but it must not
contain a value or choose a host secret-provider coordinate.

```ts
const managed = await resumeVm({
  checkpointPath,
  agentName: 'worker',
  guestCredentialMode: 'host-authenticated',
  mountPath: workspace,
  sandboxConfig: {
    network: { allowedHosts: ['api.example.com'] },
  },
  brokeredSecrets: [
    {
      id: 'example-api',
      guestEnv: 'EXAMPLE_API_TOKEN',
      hosts: ['api.example.com'],
      value: await trustedHostSecretProvider.get('example-api'),
    },
  ],
});
```

Inside the VM, `$EXAMPLE_API_TOKEN` is a random Gondolin placeholder. A normal
guest command can use it in an HTTP header:

```bash
curl -fsS \
  -H "Authorization: Bearer $EXAMPLE_API_TOKEN" \
  https://api.example.com/v1/items
```

The host proxy substitutes the real value only for the declared hostname.
Preflight fails before VM resume when the binding is missing, an environment
name collides with another guest source, or a credential host is outside the
effective network policy. Values are not substituted in request bodies or URL
queries. Gondolin also decodes, substitutes, and re-encodes HTTP Basic
authorization, covering the password encoding used by HTTPS Git credential
helpers; OAuth client secrets sent in form bodies remain host-only.

Rotation and revocation do not require exposing or changing the guest
placeholder:

```ts
managed.secretManager.updateSecret('EXAMPLE_API_TOKEN', { value: rotated });
managed.secretManager.deleteSecret('EXAMPLE_API_TOKEN');
```

Keep signing keys, GitHub App private keys, SSH keys, and other non-HTTP
credentials out of this channel. They require narrow host capabilities rather
than bearer-secret substitution.

The portable boundary is the sequence _requirement → trusted local binding →
resolved delivery_. A Docker sandbox can implement the same sequence with its
native secret broker; hostname rewriting, placeholder lifecycle, and other
provider behavior remain adapter-specific.

Live tests (`vm-manager.integration.test.ts`) boot real VMs and run only with
`MOLTNET_PI_VM_INTEGRATION=1`; CI runs them in the agent-daemon Core lane.
