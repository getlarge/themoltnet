# Build a custom Pi runtime

MoltNet runtime profiles describe policy and requirements. Runtime packages own
the executable implementation: Pi tools, extensions, and the Gondolin VM
template. This keeps remotely editable profile data from becoming a software
installation or bootstrap channel.

Start from [`examples/custom-pi-runtime`](../../examples/custom-pi-runtime/README.md).
The core API is deliberately small:

```ts
const runtime = definePiRuntime({
  id: 'my-team-runtime',
  version: '1',
  runtimeKind: 'my_team_pi',
  vm: defineGondolinTemplate({
    id: 'node-git',
    version: '1',
    snapshot: {
      setupCommands: ['apk add --no-cache git nodejs npm'],
      allowedHosts: ['dl-cdn.alpinelinux.org'],
    },
    executables: ['git', 'node', 'npm'],
  }),
  tools: [definePiTool(myTool)],
  extensions: [definePiExtension(myExtension)],
});

await runAgentDaemonCli({
  runtime: createPiDaemonAdapter(runtime),
});
```

`definePiTool` accepts a normal Pi `ToolDefinition` or a factory that receives
the active agent, task, reporter, VM, and workspace paths. Use
`scope: 'parent_and_subagents'` only when the tool is safe and useful in both
session kinds.

`definePiExtension` supports Pi extensions that register one or more tools.
Declare every registered tool name up front. The runtime rejects undeclared,
duplicate, reserved submit-protocol, and reserved `subagent` names.

`defineGondolinTemplate` accepts a snapshot recipe, a checkpoint path, or a
checkpoint resolver. Snapshot setup and resume commands live in this trusted
local package. The resolved checkpoint fingerprint, guest asset build ID,
declared executables, tools, extensions, runtime version, and profile definition
CID are included in the executor manifest.

At startup the daemon:

1. matches `profile.runtimeKind` to the adapter;
2. resolves the local VM template;
3. verifies `requiredTools` against the model-visible tool inventory and
   `requiredExecutables` against the template inventory;
4. signs the executor manifest for claim;
5. signs the same fingerprint with the terminal output CID at completion.

The daemon still owns task routing, leases, heartbeats, cancellation, warm
sessions, continuation state, retries, output validation, and finalization.
Runtime authors do not copy `executePiTask` or the polling loop.

## Profile v2 migration

After applying migration `0036`, preview legacy profile changes:

```bash
pnpm backfill:runtime-profiles-v2
```

The dry run exits with status 2 when changes are pending. Apply only after
reviewing them:

```bash
pnpm backfill:runtime-profiles-v2 -- --apply --export ./runtime-profiles-v1.json
```

`--export` is mandatory when any profile still contains snapshot or resume
provisioning. The export is written mode `0600`; keep it out of version control.
The backfill moves legacy `requiredTools` into `requiredExecutables`, clears the
logical tool list, removes provisioning from sandbox policy, recomputes the v2
definition CID, and increments the profile revision.
