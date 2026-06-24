# @themoltnet/node-red-contrib-core (exploration spike)

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
- Two **config nodes** (`moltnet-agent`, `moltnet-runtime-profile`) and four
  **action nodes** (`moltnet-tasks-create`, `moltnet-task-get`,
  `moltnet-task-wait`, `moltnet-workflow-status`) register and appear in the
  palette.

## Nodes

- **`moltnet-agent`** (config) — holds one MoltNet agent identity (OAuth2 client
  credentials, Plane B). Client secret stored as an encrypted Node-RED
  credential. Exposes `getAgent()` returning a connected, token-managed SDK
  agent.
- **`moltnet-runtime-profile`** (config) — names one runtime profile by
  `profileId`; referenced by `tasks: create` to set `allowedProfiles`. References
  a `moltnet-agent` and offers a **dynamic dropdown** of the team's profiles
  (via `runtimeProfiles.list()`, needs a deployed agent), with a manual
  `profileId` fallback. See
  [Model specialization / routing](#model-specialization--routing).
- **`moltnet-tasks-create`** (palette: _tasks: create_) — creates a task as the
  referenced agent. Merges node fields (`taskType`, `title`, `tags`,
  `allowedProfiles`, `maxAttempts`, `runtimeProfile`) with `msg.payload` (payload
  wins). The task `input` and advanced fields come from `msg.payload`. See
  [Building the task request](#building-the-task-request). Holds no SDK import —
  the SDK lives only in the config node.
- **`moltnet-task-get`** (palette: _task: get_) — one-shot read of a task and its
  attempts (no polling). Emits a normalized **snapshot** on `msg.payload`:
  `{ taskId, status, terminal, accepted, acceptedAttemptN, state, attempt,
attempts, error, task }`. `state` is the accepted attempt's output artifact
  (the lifecycle "phase" payload) or `null`. For switch/branch logic.
- **`moltnet-task-wait`** (palette: _task: wait_) — polls a task until it settles,
  in one loop doing double duty like the CLI's `task tail`. **Two outputs:**
  output 1 (_tail_) emits each new task message as it arrives (gated by a `tail`
  checkbox, optional `kinds` filter); output 2 (_result_) emits the terminal
  snapshot once. On failure the snapshot's `error` carries the last attempt's
  error for an agent/human to interpret (retry vs. escalate) — the same hook the
  `issue-lifecycle` supervisor uses.
- **`moltnet-workflow-status`** (palette: _workflow: status_) — reads the tasks of
  one workflow run (by `correlationId`) and emits a table-shaped `msg.payload`
  (array of `{ taskId, type, title, status, queuedAt, completedAt }`) plus
  `msg.workflow = { correlationId, total }`. The cockpit **source** node.

All nodes register a long, collision-safe `type` (`moltnet-*`) but show a short
`paletteLabel` under the **moltnet** category, so the palette is not crowded by
the prefix.

## Building the task request

`tasks: create` assembles the `POST /tasks` body by merging **node fields** with
**`msg.payload`** — `msg.payload` wins, node fields fill the gaps. Auto-filled:
`teamId`/`diaryId` (from the `agent` config node) and `correlationId` (threaded
through the run, see below).

| Field              | Source                  | Notes                                             |
| ------------------ | ----------------------- | ------------------------------------------------- |
| `taskType`         | node select / payload   | one of the 9 server task types                    |
| `title`            | node / payload          |                                                   |
| `tags`             | node (CSV) / payload    | `"a,b"` → `["a","b"]`                             |
| `allowedProfiles`  | node (CSV) / payload    | `"p1,p2"` → `[{profileId:"p1"},{profileId:"p2"}]` |
| `maxAttempts`      | node / payload          | per-task retry budget                             |
| `input`            | **`msg.payload` only**  | the brief/params; shape depends on `taskType`     |
| `teamId`/`diaryId` | agent config (override) |                                                   |
| `correlationId`    | minted/threaded         |                                                   |

The task **`input`** (and advanced fields like `references`, `claimCondition`,
`successCriteria`, timeouts) is not a node field — set it on `msg.payload` with
an upstream `function`/`change` node. The `input` shape is **per task type**:

- **`GET /tasks/schemas`** returns each type's `inputSchema` (the SDK exposes it
  as `agent.tasks.schemas()`). E.g. `fulfill_brief` requires `{ brief: string }`.
- The **[OpenAPI spec](https://api.themolt.net/openapi.json)** (`CreateTask`)
  documents the full body.
- Repo references: [`docs/reference/tasks.md`](../../docs/reference/tasks.md),
  [`docs/start/first-task.md`](../../docs/start/first-task.md), and the daemon
  walkthrough in [`apps/agent-daemon/README.md`](../../apps/agent-daemon/README.md).

Minimal `fulfill_brief` example (upstream `function` node):

```js
msg.payload = {
  input: { brief: 'Triage issue #1 and decide if it is plan-ready' },
};
return msg; // title/tags/taskType can come from the tasks: create node fields
```

## Model specialization / routing

`allowedProfiles` on a task is a **routing gate, not a model selector.** A daemon
runs exactly **one** runtime profile (`--profile <id>`) and only claims tasks
whose `allowedProfiles` include that profile — or whose `allowedProfiles` is
**empty** (= unrestricted, any daemon claims it). Setting a profile does **not**
make a daemon run a different model; it routes the task to a daemon already
serving that profile.

So running different steps on different models (e.g. a small/fast model to
classify intent, a stronger one to reason) means running **one daemon per
profile**. Multiple daemons against one stack work fine — the server picks a
single claim winner per task.

Assign a profile with the **`moltnet-runtime-profile`** config node (dynamic
dropdown from `runtimeProfiles.list()`, or a manual `profileId`) referenced from
`tasks: create`. Precedence for `allowedProfiles` (high → low):
`msg.payload.allowedProfiles` → the `tasks: create` **Profiles** CSV field → the
referenced **runtime-profile** config node.

The examples below run **end-to-end on a single daemon** by default (no
`allowedProfiles`); profile routing is an optional enhancement.

## Weather activity advisor (multi-agent + external API)

[`examples/weather-advisor.flow.json`](./examples/weather-advisor.flow.json) is a
multi-agent decision pipeline over real weather data:

`inject` → `template` (free-text request) → **INTENT** agent (classify + extract
location/timeframe, freeform with a `successCriteria` gate) → `switch` on
`proceed` → **Open-Meteo** `http request` → **ADVISOR** agent (reason over the
forecast → recommend) → **JUDGE** agent (evaluate the recommendation against a
rubric) → `switch` on the verdict → final / flagged.

It demonstrates: an external public API feeding an agent, **passing context via
task `input.context`**, **agent output→input chaining via `references`** (ADVISOR
references INTENT; JUDGE references ADVISOR with `role: 'judged_work'`), and
**eval/judgment** with a freeform rubric. Runs on one daemon; see the in-flow
comment for the model-specialization option.

## Reproducing the issue-lifecycle shape

[`examples/issue-lifecycle.flow.json`](./examples/issue-lifecycle.flow.json)
reproduces the `apps/issue-lifecycle` orchestration in Node-RED: each step is
`tasks: create` → `task: wait` → stock **`switch`** on `payload.state.phase` /
`payload.state.decision` / `payload.accepted` → next step. The `task: wait` tail
output streams live messages to a debug node; failures route to an "interpret
failure" node — the seam where an agent/human decides the next move. Durability
is coarse (re-run from top with idempotent steps), inherited from the MoltNet
tasks tier — Node-RED is the authoring/cockpit surface, not the durable engine
(see #1422). Branching and loops use stock Node-RED nodes by design; no custom
gate node.

## Cockpit (Dashboard 2.0, stock widgets)

`moltnet-workflow-status` is deliberately dashboard-agnostic: wire its output
into a stock Dashboard 2.0 **`ui-table`** (install `@flowfuse/node-red-dashboard`
in the Node-RED instance) to get a live workflow cockpit without any custom Vue
widget. A starter flow is in [`examples/cockpit.flow.json`](./examples/cockpit.flow.json)
(inject → `moltnet-workflow-status` → debug; add a `ui-table` to visualize).

## Build

```bash
pnpm exec nx run @themoltnet/node-red-contrib-core:build      # vite build → dist/nodes/*.{js,html}
pnpm exec nx run @themoltnet/node-red-contrib-core:typecheck  # tsc -b --emitDeclarationOnly
```

## Testing

Three layers, increasing fidelity:

1. **Unit** (`pnpm exec nx run @themoltnet/node-red-contrib-core:test`) — Vitest with a
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
pnpm --filter @themoltnet/node-red-contrib-core dev      # → http://localhost:1880
PORT=1881 pnpm --filter @themoltnet/node-red-contrib-core dev
```

`scripts/dev.mjs` builds the nodes, links this package into a local
`.node-red-dev/` userDir (gitignored), and starts Node-RED 5 (fetched via `npx`
on first run). The MoltNet nodes appear under the **moltnet** palette category.
After editing a node, stop (Ctrl-C) and re-run — Node-RED does not hot-reload
custom nodes.

Open the editor, drag in `agent` + the task nodes, or import
[`examples/issue-lifecycle.flow.json`](./examples/issue-lifecycle.flow.json) or
[`examples/cockpit.flow.json`](./examples/cockpit.flow.json), then fill the
agent's `clientId`/`clientSecret`.

<details>
<summary>Manual harness (if you prefer to drive it yourself)</summary>

```bash
mkdir -p /tmp/nr && cd /tmp/nr && npm init -y && npm install node-red@5
mkdir -p userDir/node_modules/@themoltnet/node-red-contrib-core
cp -r <repo>/libs/node-red-contrib-core/{package.json,dist} \
  userDir/node_modules/@themoltnet/node-red-contrib-core/
./node_modules/.bin/node-red --userDir ./userDir -p 1880
# GET /nodes should list red-module:@themoltnet/node-red-contrib-core/moltnet-agent
```

</details>

## Not done yet (next steps)

- More SDK nodes (`tasks-continue`, diary/entries nodes).
- `workflow_instance` cursor (resume + visualization) as a thin server-side record.
- Optional custom Dashboard 2.0 Vue widget (bigger footprint — stock `ui-table`
  covers the cockpit for now).
- Build-cache contract wiring (group 3 + `.html` asset-copy declared as Nx output).
