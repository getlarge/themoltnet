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

## Local smoke test (throwaway Node-RED 5 harness)

```bash
mkdir -p /tmp/nr && cd /tmp/nr && npm init -y && npm install node-red@5
mkdir -p userDir/node_modules/@themoltnet/node-red-moltnet
cp -r <repo>/libs/node-red-moltnet/{package.json,dist} \
  userDir/node_modules/@themoltnet/node-red-moltnet/
./node_modules/.bin/node-red --userDir ./userDir -p 1880
# then GET /nodes should list red-module:@themoltnet/node-red-moltnet/moltnet-agent
```

## Not done yet (next steps)

- More SDK nodes (`tasks-get`, `tasks-continue`).
- `workflow_instance` cursor (resume + visualization) as a thin server-side record.
- Optional custom Dashboard 2.0 Vue widget (bigger footprint — stock `ui-table`
  covers the cockpit for now).
- Build-cache contract wiring (group 3 + `.html` asset-copy declared as Nx output).
