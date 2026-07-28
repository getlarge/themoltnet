# Build a custom Pi runtime

MoltNet runtime profiles describe policy and requirements. Runtime packages own
the executable implementation: Pi tools, extensions, and the Gondolin VM
template. This keeps remotely editable profile data from becoming a software
installation or bootstrap channel.

Start from
[`examples/custom-pi-runtime`](https://github.com/getlarge/themoltnet/tree/main/examples/custom-pi-runtime).
The runtime module default-exports the adapter consumed by the universal daemon
CLI:

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

export default createPiDaemonAdapter(runtime);
```

Build the module, then run it through the published daemon:

```bash
npx @themoltnet/agent-daemon \
  --runtime ./dist/runtime.js \
  poll \
  --agent <agent-name> \
  --team <team-id> \
  --profile <profile-id>
```

The runtime can also be an installed package name. Package resolution starts
from the operator's current project, so the runtime and its dependencies remain
under local deployment control. If the package uses conditional exports, expose
its runtime entry through the `default` condition so Node can resolve it from
the host CLI:

```json
{
  "exports": {
    ".": {
      "default": "./dist/runtime.js",
      "import": "./dist/runtime.js",
      "types": "./dist/runtime.d.ts"
    }
  }
}
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
4. signs and registers the executor manifest once, then references its
   fingerprint when claiming candidates;
5. signs the same fingerprint with the terminal output CID at completion.

Registration binds the manifest fingerprint to the authenticated agent. A
claim lost to a `409` race therefore does not require another signature or
upload the manifest again.

The daemon still owns task routing, leases, heartbeats, cancellation, warm
sessions, continuation state, retries, output validation, and finalization.
Runtime authors do not create a launcher or copy `executePiTask` or the polling
loop.

`--runtime` is intentionally local-only. A remote profile selects
`runtimeKind` and declares requirements, but cannot name, install, or update a
runtime module. The loaded adapter must match the selected profile's
`runtimeKind`.

## Profile v2 migration

Apply migration `0036` before deploying profile-v2 writers. It intentionally
retains the retired enum type so a rolling deployment never depends on an
immediately destructive type drop. Existing profiles remain definition version
1; new API writes use version 2.

Quiesce legacy daemons before the backfill. A v2 daemon deliberately refuses
definition-v1 profiles, and the REST API refuses to patch them, so no old
snapshot or resume provisioning can execute or be silently preserved during
the transition. Preview legacy profile changes:

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
definition CID, sets `definitionVersion` to 2, and increments the profile
revision. Before opening its transaction it reads the mode-`0600` export back,
parses it, and verifies the exported profile count and IDs.

The Pi peer dependency versions are intentionally exact. Pi loads extensions
against concrete `pi-ai` and `pi-coding-agent` APIs, so runtime authors should
upgrade those pins only with the loader smoke test and runtime suite.
