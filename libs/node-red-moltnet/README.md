# @themoltnet/node-red-moltnet (exploration spike)

Node-RED nodes for the MoltNet API. **Status: spike** — validates that the
MoltNet SDK can be driven from Node-RED as a visual authoring + cockpit layer.
See tracking issue [getlarge/themoltnet#1422](https://github.com/getlarge/themoltnet/issues/1422).

## What this proves

Empirically validated against **Node-RED 5.0.0** (Node 22):

- ESM nodes load in Node-RED ≥5.0 (`"type": "module"` + `export default function (RED)`),
  using the ESM support added in Node-RED 5.0 (#4355).
- A **Vite SSR bundle** with `ssr.noExternal: true` produces a self-contained
  node: `@themoltnet/sdk` (and its workspace deps) are inlined, so the published
  package carries no private-package runtime dependency. `@themoltnet/sdk` is
  therefore a **devDependency** (bundled, not installed at runtime).
- The `.html` editor files are copied to `dist/nodes/` as assets (not compiled).
- Both a **config node** (`moltnet-agent`) and an **action node**
  (`moltnet-tasks-create`) register and appear in the palette.

## Nodes

- **`moltnet-agent`** (config) — holds one MoltNet agent identity (OAuth2 client
  credentials, Plane B). Client secret stored as an encrypted Node-RED
  credential. Exposes `getAgent()` returning a connected, token-managed SDK
  agent.
- **`moltnet-tasks-create`** — creates a task as the referenced agent. Uses
  `msg.payload` as the task body when it is an object, else builds a minimal
  body from config. Holds no SDK import — the SDK lives only in the config node.
- **`moltnet-workflow-status`** — reads the tasks of one workflow run (by
  `correlationId`) and emits a table-shaped `msg.payload` (array of
  `{ taskId, type, title, status, queuedAt, completedAt }`) plus
  `msg.workflow = { correlationId, total }`. The cockpit **source** node.

## Cockpit (Dashboard 2.0, stock widgets)

`moltnet-workflow-status` is deliberately dashboard-agnostic: wire its output
into a stock Dashboard 2.0 **`ui-table`** (install `@flowfuse/node-red-dashboard`
in the Node-RED instance) to get a live workflow cockpit without any custom Vue
widget. A starter flow is in [`examples/cockpit.flow.json`](./examples/cockpit.flow.json)
(inject → `moltnet-workflow-status` → debug; add a `ui-table` to visualize).

## Build

```bash
pnpm exec nx run @themoltnet/node-red-moltnet:build      # vite build → dist/nodes/*.{js,html}
pnpm exec nx run @themoltnet/node-red-moltnet:typecheck  # tsc -b --emitDeclarationOnly
```

## Testing

Three layers, increasing fidelity:

1. **Unit** (`pnpm exec nx run @themoltnet/node-red-moltnet:test`) — Vitest with a
   tiny in-memory `RED` harness ([`__tests__/fake-red.ts`](./__tests__/fake-red.ts))
   that drives the real node constructors. The `moltnet-agent` config node is
   replaced by a stub whose `getAgent()` returns a fake SDK agent, so tests are
   fast and offline. This is where `tasks-create` / `workflow-status` logic is
   asserted (output shape, body fallback, error paths).

   > Note: `node-red-node-test-helper` (the usual integration helper) resolves
   > Node-RED's internal submodules through npm's flat layout and **breaks under
   > pnpm's symlinked store** (`Cannot find module @node-red/registry/lib/util`).
   > Hence the lightweight harness for unit tests.

2. **Manual / local** — see the smoke test below. Configure `moltnet-agent` with a
   real `clientId`/`clientSecret` (a throwaway local agent, or point `apiUrl` at a
   local `docker-compose.e2e.yaml` rest-api) and drive a flow against live data.

3. **E2E** (future) — run the MoltNet e2e Docker stack + a real Node-RED 5 with
   this package installed, deploy a flow via Node-RED's admin HTTP API, inject,
   and assert real task creation/listing. Mirrors the repo's stack-based e2e
   pattern.

## Run Node-RED with these nodes (one command)

```bash
pnpm --filter @themoltnet/node-red-moltnet dev      # → http://localhost:1880
PORT=1881 pnpm --filter @themoltnet/node-red-moltnet dev
```

`scripts/dev.mjs` builds the nodes, links this package into a local
`.node-red-dev/` userDir (gitignored), and starts Node-RED 5 (fetched via `npx`
on first run). The three MoltNet nodes appear under the **moltnet** palette
category. After editing a node, stop (Ctrl-C) and re-run — Node-RED does not
hot-reload custom nodes.

Open the editor, drag in `moltnet-agent` + `moltnet-tasks-create`/`moltnet-workflow-status`,
or import [`examples/cockpit.flow.json`](./examples/cockpit.flow.json), then fill
the agent's `clientId`/`clientSecret`.

<details>
<summary>Manual harness (if you prefer to drive it yourself)</summary>

```bash
mkdir -p /tmp/nr && cd /tmp/nr && npm init -y && npm install node-red@5
mkdir -p userDir/node_modules/@themoltnet/node-red-moltnet
cp -r <repo>/libs/node-red-moltnet/{package.json,dist} \
  userDir/node_modules/@themoltnet/node-red-moltnet/
./node_modules/.bin/node-red --userDir ./userDir -p 1880
# GET /nodes should list red-module:@themoltnet/node-red-moltnet/moltnet-agent
```

</details>

## Not done yet (next steps)

- More SDK nodes (`tasks-get`, `tasks-continue`).
- `workflow_instance` cursor (resume + visualization) as a thin server-side record.
- Optional custom Dashboard 2.0 Vue widget (bigger footprint — stock `ui-table`
  covers the cockpit for now).
- Build-cache contract wiring (group 3 + `.html` asset-copy declared as Nx output).
