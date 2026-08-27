# Build a custom Pi runtime

MoltNet runtime profiles describe policy and requirements. Runtime packages own
the executable implementation: Pi tools, extensions, and the Gondolin VM
template. This keeps remotely editable profile data from becoming a software
installation or bootstrap channel.

Start with the example's
[end-to-end manual smoke test](https://github.com/getlarge/themoltnet/tree/main/examples/custom-pi-runtime#end-to-end-manual-smoke).
Its README is the complete operational walkthrough; this page explains the
runtime authoring contract.
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
  tools: [definePiTool(myTool, { effects: {} })],
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

Every tool must declare the effects directly controlled by its implementation:

```ts
const hostReader = definePiTool(hostReaderDefinition, {
  effects: { network: ['host'] },
});

const guestReader = definePiTool({
  descriptor: guestReaderDescriptor,
  effects: { network: ['guest'] },
  create: (context) => createGuestReader(context.vm),
});
```

`globalThis.fetch` is a host network effect. Network access performed through
`context.vm.exec(...)` is a guest network effect. Declare both for a mixed
implementation and use `effects: {}` when the implementation itself performs
no network access. That empty object attests only the absence of a direct
network effect; it says nothing about filesystem, process, provider, or
downstream effects. The runtime validates, deduplicates, sorts, canonicalizes,
and freezes these declarations. `{ network: [] }` canonicalizes to `{}`.

Effects describe only the operations implemented directly by that tool. They
do not include LLM provider traffic or another tool, MCP server, host
capability, or delegated call that the tool asks a downstream component to
perform. `scope` remains independent: it controls which Pi sessions can invoke
a tool, not where its implementation runs.

`definePiExtension` supports Pi extensions that register one or more tools.
Declare every registered tool and its direct effects up front:

```ts
definePiExtension({
  id: 'reviews',
  declaredTools: [{ name: 'review_issue', effects: { network: ['host'] } }],
  factory: reviewExtension,
});
```

The runtime rejects undeclared, duplicate, reserved submit-protocol, and
reserved `subagent` names.

`defineGondolinTemplate` accepts a snapshot recipe, a checkpoint path, or a
checkpoint resolver. Snapshot setup and resume commands live in this trusted
local package. The resolved checkpoint fingerprint, guest asset build ID,
declared executables, tools, extensions, runtime version, and profile definition
CID are included in the executor manifest.

Runtime-contributed entries in `tools[]` always include `effects`. Kernel tool
entries and historical manifests may omit it; omission means unknown and must
not be interpreted as `effects: {}`. Changing a declaration changes the signed
executor-manifest fingerprint. The manifest remains v1 because this field is
additive.

### Choose the network locus deliberately

Sandbox network policy governs HTTP(S) initiated inside the Gondolin guest. It
applies when a tool routes work through `context.vm`, including Gondolin's
hostname and address checks. A tool that calls host `fetch` runs as trusted
daemon code and is not constrained by `sandbox.network.*`.

Use guest egress when the profile should govern the destination. Use host
egress when the implementation must retain a host-owned secret or deliberately
reach a service unavailable to the guest. For a host-owned HTTP integration,
prefer the fixed-origin helper:

```ts
const apiFetch = createFixedOriginHostFetch({
  origin: 'https://api.example.com',
  timeoutMs: 5_000,
  maxResponseBytes: 256 * 1024,
  responseHeaders: ['x-request-id'],
});

const response = await apiFetch(`/v1/issues/${encodeURIComponent(issueId)}`, {
  headers: { Authorization: `Bearer ${token}` },
  signal,
});
```

`createFixedOriginHostFetch` accepts only origin-relative `/...` paths, uses
manual redirect handling and rejects redirect or cross-origin responses,
combines caller cancellation with a deadline, bounds the body before returning
a replayable `Response`, and returns stable errors that do not reflect request
or provider data. Constructor timeout and response-size limits are ceilings:
per-request overrides may narrow them but cannot widen them. Response headers
are stripped unless explicitly named in `responseHeaders`, and credential and
framing headers cannot be selected.

The helper does not retry, and it does not bound request bodies, concurrent
requests, or request rate. Tool authors must impose those limits when their
integration accepts bodies or can be invoked concurrently. An injected
`fetch` is a trusted test/transport dependency: it must honor
`redirect: 'manual'`; the helper still rejects a returned response marked as
redirected or carrying a different final origin.

Use `redactLiteralSecrets` before projecting provider content that might echo a
credential. It replaces exact secret literals of at least eight characters;
encoded, transformed, or case-shifted representations require explicit
redaction by the tool author.

The helper does not enforce private-address ranges or protect against DNS
rebinding. A fixed origin reduces model-controlled URL surface, but it is not an
SSRF firewall. Tool authors must still validate every model-supplied argument,
encode path components, constrain methods and headers, and return only bounded,
redacted projections.

Runtime policy gates whether the model may invoke a tool; it does not sandbox
the trusted tool body or inspect commands issued inside that body. Keep these
authority planes separate when reviewing a runtime: provider inference,
runtime-contributed host tools, managed MCP calls, host capabilities, sandbox
egress, Docker enforcement, and Pi kernel-tool execution each have their own
transport and enforcement boundary. Do not infer one from another or from a
tool named `subagent`.

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
prepared result contains the manifest, tool and executable inventories, and
the task-executor factory. Runtime adapters do not receive `configDir` and do
not return an attestor: authentication, signing-key resolution, identity
validation, and executor attestation belong exclusively to daemon core.

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

## Deployment

Apply migration `0036` before deploying runtime-kind or executable-requirement
writers. It changes `runtimeKind` from a fixed enum to a validated string and
adds `requiredExecutables`.

Remote sandbox provisioning was never part of the supported deployment path,
so there is no versioned profile format or provisioning backfill. The API and
daemon validate the current policy-only sandbox shape directly. Snapshot setup
and resume commands belong exclusively to the trusted local runtime module.

The Pi peer dependency versions are intentionally exact. Pi loads extensions
against concrete `pi-ai` and `pi-coding-agent` APIs, so runtime authors should
upgrade those pins only with the loader smoke test and runtime suite.
