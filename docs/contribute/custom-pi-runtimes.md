# Build a custom Pi runtime

MoltNet runtime profiles describe policy and requirements. Runtime packages own
the executable implementation: Pi tools, extensions, and the Gondolin VM
template. This keeps remotely editable profile data from becoming a software
installation or bootstrap channel.

Start with the example's
[end-to-end manual smoke test](https://github.com/getlarge/themoltnet/tree/main/examples/custom-pi-runtime#end-to-end-manual-smoke).
Its README is the complete operational walkthrough; the runtime authoring
contract follows. The runtime module default-exports the adapter consumed by the
universal daemon CLI:

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
  extensions: [definePiExtension({ extension: myNativeDurableExtension })],
});

export default createPiDaemonAdapter(runtime);
```

Build the module, then run it through the published daemon:

```bash
moltnet-agent \
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
conversation kinds.

`definePiExtension` accepts native Pi Durable extensions and derives tool
declarations from them. The runtime rejects duplicate, reserved submit-protocol,
and reserved `subagent` names.

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

`DaemonRuntimeAdapter` is a pre-1.0 extension contract. Its `prepare()` input
contains only the selected profile and an optional progress callback. The
prepared result contains the manifest, tool and executable inventories, and the
task-executor factory. Runtime adapters do not receive `configDir` and do not
return an attestor: authentication, signing-key resolution, identity validation,
and executor attestation belong exclusively to daemon core.

Registration binds the manifest fingerprint to the authenticated agent. A claim
lost to a `409` race therefore does not require another signature or upload the
manifest again.

The daemon owns task routing, leases, heartbeats, cancellation, workspace
cleanup, retries, and finalization. Pi Durable owns conversation persistence and
recovery. Runtime authors do not create a launcher or copy `executePiTask` or
the polling loop.

`--runtime` is intentionally local-only. A remote profile selects `runtimeKind`
and declares requirements, but cannot name, install, or update a runtime module.
The loaded adapter must match the selected profile's `runtimeKind`.

## Deployment

Apply migration `0036` before deploying runtime-kind or executable-requirement
writers. It changes `runtimeKind` from a fixed enum to a validated string and
adds `requiredExecutables`.

Remote sandbox provisioning was never part of the supported deployment path, so
there is no versioned profile format or provisioning backfill. The API and
daemon validate the current policy-only sandbox shape directly. Snapshot setup
and resume commands belong exclusively to the trusted local runtime module.

The Pi peer dependency versions are intentionally exact. Pi loads extensions
against concrete `pi-ai` and `pi-coding-agent` APIs, so runtime authors should
upgrade those pins only with the loader smoke test and runtime suite.

## Pi 1.0 classification

Configure classifier-provider credentials through the daemon's existing provider
configuration. Pi resolves the selected provider's credentials for
`models.classify`; runtime extensions must not supply placeholder API keys or
create a separate provider identity. Keep the coding runtime's primary model a
chat model.

Set the runtime profile's optional `classifier` to
`{ "provider": "team", "model": "decisions" }`. The same Pi runtime then handles
standalone `classify` tasks without starting a coding VM and exposes a
`classify` tool within coding tasks. Include `classify` in an enforced tool
policy to make it available. Omit the selector or set it to `null` to disable
this capability. The profile's primary `provider` and `model` continue to select
the chat model.

In the daemon provider configuration, declare the classifier model with
`{ "id": "decisions", "type": "classifier", "api": "typesafe-system-one" }`. Set
the provider's endpoint and credentials through the normal provider settings;
classifier models use the same credential resolver as chat models. The supported
classifier API is currently `typesafe-system-one`; the provider name is
arbitrary. An optional `contextWindow` overrides the default of 8192 tokens.

## Pi Durable execution

The default `gondolin_pi` daemon runtime uses Pi Durable. Apply the
runtime-store migration and configure runtime-session object storage before
starting workers. No separate runtime kind or persistence switch is required.

The existing Pi adapter exposes `read`, `write`, `edit`, `bash`, `ls`, `find`,
and `grep`, the MoltNet tools, custom `definePiTool` contributions, and the
task's validated submit-output tool. It resolves the profile's tool policy
before scheduling work and checks safe replays again. Task provenance, signing
policy, artifact reads, and runtime instructions use the same implementation as
the coding runtime.

Task types that enable delegation use Durable child conversations with the
existing named subagent output contracts. Child creation, admission, and output
are persisted in the parent's store; recovery reuses the child. Parent-only
custom tools and nested delegation are excluded. Host tools and custom tool
contributions are not automatically replayed after an interrupted call.

Native Durable extensions are registered with
`definePiExtension({ extension: defineExtension({ name: 'team-tools', tools: [...] }) })`.
Import `defineExtension` from `@earendil-works/pi-durable`. Tool calls are
checked against the runtime policy, including recovery. Set
`scope: 'parent_and_subagents'` to share an extension with child conversations.
Extension names beginning `moltnet-` are reserved. Coding-agent session
extensions, including `piCodemode()`, require migration to the native Durable
API before use in the daemon. Runtime-profile sampling options use the shared
provider payload policy, including omission of options unsupported by the
selected model.

The API stores each immutable commit payload in object storage and publishes its
checksum, sequence, and receipt in Postgres. A transaction also appends slim
entry references to `task_messages`. Full conversation content is read through
`agent.runtimeSessions.read(storeId, afterSeq, { teamId })`; it is not copied
into message deltas. Use
`runtimeSessions.getDurableForAttempt(taskId, attemptN, { teamId })` to locate
the store. The same namespace owns writer acquisition, renewal, ID allocation,
commit append, and release under `/runtime-sessions/durable`. A 30-second writer
lease fences each store, with renewal every five seconds. MoltNet's task lease,
claimant, and executor fingerprint must remain valid for every write.

After a process crash, restart the same runtime module, agent, profile, project,
and workspace configuration, then reattach explicitly:

```bash
moltnet-agent once \
  --agent <agent-name> --team <team-id> --profile <profile-id> \
  --task-id <task-id> --resume-attempt <attempt-number>
```

Wait for the former writer lease to expire. Reattachment does not create an
attempt or acquire an expired MoltNet task lease. A lost writer or uncertain
commit stops the worker without finalizing the attempt. A persisted terminal
output is returned on recovery without another model call; unfinished unsafe
tools are reported as interrupted by Pi rather than replayed automatically.

Conversation recovery needs no local JSONL or SQLite session. Gondolin files
have a separate lifetime: retain the workspace volume and its `.moltnet`
workspace receipt. A missing receipt stops recovery; restore the volume before
retrying. The daemon cannot reconstruct uncommitted files or guest `/tmp` data
from conversation history. `continueFrom` uses the parent's API store and either
extends its conversation or forks its committed history. Repository continuation
uses the source output branch or pinned input revision when available.

Pi Durable has its own scheduler and does not depend on Absurd. Absurd continues
to own MoltNet task orchestration. The runtime rebuilds an in-memory storage
index from the API commit log; measure reopen time and memory on representative
histories before increasing deployment size. Failed object uploads/publications
may leave unreferenced objects; retain them until a reference-aware maintenance
pass can prove they are unreferenced, and never expire this prefix wholesale.

Incremental store traffic has separate bounded rate limits:
`RATE_LIMIT_RUNTIME_STORE` (default 6000 requests/minute per identity) and
`RATE_LIMIT_RUNTIME_STORE_IP` (default 12000 requests/minute per IP before
credential resolution). Size these for concurrent workers behind your ingress.
They do not consume the ordinary API mutation/read budget. Sustained throttling
interrupts the writer and requires resuming the attempt while its task lease
remains valid.

Task/profile context and skills are delivered into the guest. Thinking level,
sampling options, and turn/reminder bounds are supported.
