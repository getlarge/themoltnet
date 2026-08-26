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
- The guest credential boundary: the guest never receives the
  `.moltnet/<agent>` tree, and `MOLTNET_*` names are refused in
  runtime-controlled guest environment (`assertGuestEnvironmentBoundary`).
- `VmConfig.brokeredSecrets` — host-brokered secrets: the guest sees a
  placeholder, Gondolin's `SecretManager` substitutes the value only in
  requests to the declared protocol, host patterns, and ports.
- `VmConfig.trustedHttpFetch` — an optional trusted-host transport passed to
  Gondolin after its request/IP checks and secret substitution. It is outside
  `SandboxConfig`, runtime profiles, and guest control.
- `ensureSnapshot` — build and cache the base checkpoint.
- Small helpers: `findMainWorktree`, `isResolvedPathInsideRoot`,
  `abortableResource` / `throwIfAborted`.

## What it deliberately does not own

- **Provider authentication.** The coding-agent session and its model calls run
  host-side (Pi's `createAgentSession` reads the host `~/.pi/agent` auth), so no
  provider auth is projected into the guest — the guest only executes tools via
  `vm.exec`.
- Tool definitions, tool policy, task execution, workspace preparation —
  all Pi-runtime concerns.

## Known boundary facts

- Network egress policy is hostname-granular. Brokered credentials add a
  separately attested protocol and port boundary.
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

The host proxy substitutes the real value only for the declared origin. HTTPS
on port 443 is the default. Plain HTTP requires an explicit `protocol: 'http'`
and should be limited to an exact port for a controlled local fixture.
Preflight fails before VM resume when the binding is missing, an environment
name collides with another guest source, or a credential host is outside the
effective network policy. Values are not substituted in request bodies or URL
queries. Gondolin also decodes, substitutes, and re-encodes HTTP Basic
authorization, covering the password encoding used by HTTPS Git credential
helpers; OAuth client secrets sent in form bodies remain host-only.

`vm.network.policy_bound` reports the complete effective hostname policy, and
`vm.network.origin_checked` reports canonical protocol/hostname/port decisions
at request and IP phases. Both diagnostics are value-free.

Rotation and revocation do not require exposing or changing the guest
placeholder:

```ts
managed.secretManager.rotateSecret('EXAMPLE_API_TOKEN', rotated);
managed.secretManager.revokeSecret('EXAMPLE_API_TOKEN');
```

Keep signing keys, GitHub App private keys, SSH keys, and other non-HTTP
credentials out of this channel. They require narrow host capabilities rather
than bearer-secret substitution.

The portable boundary is the sequence _requirement → trusted local binding →
resolved delivery_. A Docker sandbox can implement the same sequence with its
native secret broker; hostname rewriting, placeholder lifecycle, and other
provider behavior remain adapter-specific, while the attested protocol, host,
and port boundary must remain equivalent.

Live tests (`vm-manager.integration.test.ts`) boot real VMs and run only with
`MOLTNET_PI_VM_INTEGRATION=1`; CI runs them in the agent-daemon Core lane.
