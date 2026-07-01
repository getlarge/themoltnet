# @themoltnet/node-red-contrib-core

Node-RED nodes for the MoltNet API — drive the MoltNet SDK from Node-RED as a
visual authoring + cockpit layer. See tracking issue
[getlarge/themoltnet#1422](https://github.com/getlarge/themoltnet/issues/1422).

## What it provides

Empirically validated against **Node-RED 5.0.0** (Node 22):

- ESM nodes load in Node-RED ≥5.0 (`"type": "module"` + `export default function (RED)`),
  using the ESM support added in Node-RED 5.0 (#4355).
- A **Vite SSR bundle** with `ssr.noExternal: true` produces a self-contained
  node: `@themoltnet/sdk` (and its workspace deps) are inlined, so the published
  package carries no private-package runtime dependency. `@themoltnet/sdk` is
  therefore a **devDependency** (bundled, not installed at runtime).
- The `.html` editor files are copied to `dist/nodes/` as assets (not compiled).
- Two **config nodes** (`moltnet-agent`, `moltnet-runtime-profile`) and eleven
  **action nodes** (`moltnet-tasks-create`, `moltnet-task-get`,
  `moltnet-task-wait`, `moltnet-task-artifacts-list`,
  `moltnet-task-artifact-upload`, `moltnet-task-artifact-download`,
  `moltnet-workflow-status`, `moltnet-task-builder`, `moltnet-task-reader`,
  `moltnet-tasks-list`, `moltnet-entries-search`)
  register and appear in the palette.

For editor styling, install the separate companion package
`@themoltnet/node-red-theme`. The theme is intentionally not bundled with these
runtime nodes so it can be used independently by Node-RED instances that only
want the MoltNet editor skin.

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
- **`moltnet-tasks-list`** (palette: _tasks: list_) — lists tasks for the
  referenced agent's team. Supports the server task filters (`status`,
  `statuses`, `taskTypes`, `tags`, `excludeTags`, profile/correlation/diary,
  proposer/claimer ids, attempts, date windows, `limit`, `cursor`). Node fields
  fill the query; an object `msg.payload` overrides them. Emits task rows on
  `msg.payload` and pagination/query metadata on `msg.tasks`.
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
- **`moltnet-task-artifacts-list`** (palette: _task artifacts: list_) — lists a
  task's artifacts for the configured team. Reads task id from
  `msg.taskId`/`msg.payload.taskId`/`msg.payload.id` or the node field, supports
  `limit`/`cursor`, emits artifact rows on `msg.payload`, and places
  pagination/query metadata on `msg.artifacts`.
- **`moltnet-task-artifact-upload`** (palette: _task artifact: upload_) —
  uploads bytes for a task attempt. Reads bytes from `msg.payload` when it is a
  string/Buffer/Uint8Array/ArrayBuffer, or from object payload fields
  `content`, `body`, or base64 `contentBase64`. Team context is the configured
  node/agent by default; message team overrides require an explicit checkbox.
  Emits artifact metadata on `msg.payload` and `msg.artifact`.
- **`moltnet-task-artifact-download`** (palette: _task artifact: download_) —
  downloads an artifact by task id, attempt number, and CID. Emits the artifact
  bytes as a Buffer on `msg.payload` and metadata on `msg.artifact`. Upload and
  download nodes enforce a local 25 MiB byte limit by default.
- **`moltnet-workflow-status`** (palette: _workflow: status_) — reads the tasks of
  one workflow run (by `correlationId`) and emits a table-shaped `msg.payload`
  (array of `{ taskId, type, title, status, queuedAt, completedAt }`) plus
  `msg.workflow = { correlationId, total }`. The cockpit **source** node.
- **`moltnet-task-builder`** (palette: _task: build_) — composes a validated
  `tasks.create` body from the SDK fluent builder (`buildFreeform`). Pure offline
  transform: reads `teamId`/`diaryId` from the referenced `agent` (with optional
  typedInput overrides), maps **context rows** (slug ← msg/flow/global/str/json),
  binds a prior task's output via **References from** (a `msg`-path to an
  `outputRef` from `task: read`), and toggles the **submit-output** / schema
  gates. Emits the flat body on `msg.payload` for a downstream `tasks: create`
  (the SDK's `{ body, teamId }` envelope is flattened to `{ ...body, teamId }`).
  Validation errors surface on the node (red ring).
- **`moltnet-task-reader`** (palette: _task: read_) — parses a completed snapshot
  (from `task: wait`/`task: get`) into typed result data via the SDK
  `createResultReader`. Emits the typed output on `msg.payload` and a flat
  `msg.result = { summary, outputRef, artifact, artifactBody, accepted, usage }`.
  The pre-computed **`outputRef`** (`{ taskId, outputCid, role }`) chains straight
  into a downstream `task: build`'s **References from**; set an **artifact
  kind/title** to pre-parse a JSON artifact body into `msg.result.artifactBody`.
- **`moltnet-entries-search`** (palette: _entries: search_) — searches diary
  entries using the SDK hybrid search endpoint. Supports `diaryId`, `query`,
  `tags`, `excludeTags`, `entryTypes`, `excludeSuperseded`, `limit`, `offset`,
  and relevance/recency/importance weights. A string `msg.payload` is treated as
  the query; an object `msg.payload` overrides node fields and may use camelCase
  SDK keys or snake_case MCP-style keys. Emits entries on `msg.payload` and
  search metadata on `msg.entries`.

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
`successCriteria`, timeouts) is not a `tasks: create` node field. The preferred
way to compose it is the **`task: build`** node (palette _task: build_), which
drives the SDK builder: set the brief, map context rows, toggle the
submit-output gate, and chain a prior task's `outputRef` via **References from**,
then wire `task: build → tasks: create`. For ad-hoc cases you can still set
`msg.payload` directly with an upstream `function`/`change` node. The `input`
shape is **per task type**:

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

`inject` → `template` (free-text request) → **`task: build`** (INTENT) →
**`tasks: create`** → **`task: wait`** → **`task: read`** (INTENT) → `switch` on
`proceed` → **Open-Meteo** `http request` → **`task: build`** (ADVISOR) →
`tasks: create` → `task: wait` → **`task: read`** (ADVISOR) → **`task: build`**
(JUDGE) → `tasks: create` → `task: wait` → **`task: read`** (JUDGE) → `switch` on
the verdict → final / flagged.

Each agent step is the same four-node chain: **`task: build`** composes the body
(brief + context rows + gates), **`tasks: create`** submits it, **`task: wait`**
polls to completion, and **`task: read`** parses the snapshot into typed output
plus a flat `msg.result`. Output→input chaining is explicit: `task: read` emits a
pre-computed `msg.result.outputRef`, and the next `task: build` references it via
its **References from** field (ADVISOR references INTENT as `context`; JUDGE
references ADVISOR as `judged_work`). The INTENT and JUDGE readers set
**artifact kind `json`** so the structured slots/verdict land on
`msg.result.artifactBody` — no hand-rolled JSON extraction. Three small
`function` nodes remain only for genuine app glue (lifting parsed slots onto
`msg` for the switch + forecast-URL, and carrying the recommendation summary
past the JUDGE payload overwrite).

It demonstrates: an external public API feeding an agent, **passing context via
the builder's context rows**, **agent output→input chaining via the reader's
`outputRef` + the builder's References-from**, and **eval/judgment** with a
freeform rubric. Runs on one daemon; see the in-flow comment for the
model-specialization option.

## A/B eval with judge subflow

[`examples/ab-eval-with-judge.flow.json`](./examples/ab-eval-with-judge.flow.json)
imports a reusable **A/B eval with judge** subflow plus a small demo tab. The
subflow runs one `run_eval` producer lane, records lightweight producer
metadata, then creates one `judge_eval_attempt` task and stores the variant
score/delta in flow context. The judge owns the rubric; the producer-side flow
does not duplicate hidden criteria. The demo tab owns the reusable workflow
runner pattern: initialize one correlation id, fan out configured variants in
parallel, record successful or failed lanes, and emit a group result only once
all expected variants have settled.

The bundled seed uses `evals/moltnet-practices/dbos-after-commit` and compares
`baseline-no-context` against `rendered-pack-dbos-rule`, a rendered-pack-style
context excerpt that teaches the DBOS/Drizzle transaction boundary. Replace
that inline context with a rendered MoltNet pack or skill content to evaluate a
real candidate context source against the same hidden judge rubric.

Fill the `moltnet-agent` config after import. Runtime-profile config nodes are
included and default to the shared Gemma eval profile; clear them to let any
eligible daemon claim both tasks, or set producer/judge profile IDs and run one
daemon per profile. The example uses `maxAttempts=2` for producer and judge
tasks so transient tool/model failures retry at the task layer before the lane
is marked failed.
Callers can also route per scenario or variant without editing the subflow:
set `msg.evalRuntimeProfiles.producer`, `msg.evalRuntimeProfiles.judge`,
`msg.evalScenario.runtimeProfiles.producer`, `msg.evalScenario.runtimeProfiles.judge`,
or the variant-level `runtimeProfile` / `producerRuntimeProfile` /
`judgeRuntimeProfile`. Each value may be a profile id string, `{ profileId }`,
or a full `allowedProfiles` array.

## Freeform deep review workflow

[`examples/deep-review-freeform.flow.json`](./examples/deep-review-freeform.flow.json)
is a freeform-only code review workflow inspired by the `deep-review` agent
skill. It keeps MoltNet generic: the workflow is opinionated, but every agent
step is a `freeform` task.

The flow shape is:

`inject` -> `entries: search` -> **FREEZE** -> **PREFLIGHT** -> stock `switch`
on `PROCEED | PIVOT | ASK`. `PIVOT` becomes a design-review publish task.
`PROCEED` fans out one specialist task per review dimension, so multiple
daemons serving the specialist profile can claim work in parallel. Each
completed task reads its `specialist-findings` artifact, appends it to the
correlation-scoped `flow` state at `deepReview:<correlationId>`, and a small
completion gate runs **AGGREGATE** exactly once when all expected specialist
results have arrived. Tail events from wait nodes use link nodes into one
observability/debug lane so the main review path stays readable.

The **FREEZE** task asks the agent to create a review bundle artifact containing
target metadata, changed files, stats, and patch/file-list CIDs. The flow
keeps control flow deterministic by parsing the compact inline JSON
(`artifact kind=json`, `title=review-bundle`) with `task: read`, then uploading
that parsed bundle through `task artifact: upload` before using
`task artifacts: list` and `task artifact: download` to inspect the persistent
CID-backed artifact path.

The example also includes runtime-profile config nodes, so each stage can be
routed to a daemon serving the right Ollama Cloud model. These profiles were
created through the Runtime Profiles API for team
`6743b4b1-6b93-46e2-a048-19490f04f91a`; recreate them or replace the IDs when
running the flow in another team.

| Stage      | Profile ID                             | Provider / model                      | Settings                                                                                                                                                                                                                  |
| ---------- | -------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FREEZE     | `1a653eb9-7bfa-475f-b517-c070c9c25b5e` | `ollama-cloud/qwen3-coder:480b-cloud` | `thinkingLevel=high`, `temperature=0.1`, `maxOutputTokens=12000`, `maxTurns=60`, `maxBashTimeouts=5`, `defaultWorkspaceMode=dedicated_worktree`, `allowedWorkspaceModes=[dedicated_worktree]`, requires `git`, `gh`, `rg` |
| PREFLIGHT  | `f4bb1d9b-6281-4158-ad88-cbcb1198c3dc` | `ollama-cloud/qwen3-coder:480b-cloud` | `thinkingLevel=high`, `temperature=0.1`, `maxOutputTokens=10000`, `maxTurns=16`, `maxBashTimeouts=2`, `defaultWorkspaceMode=shared_mount`, `allowedWorkspaceModes=[shared_mount]`, requires `git`, `rg`                   |
| SPECIALIST | `f50e9c58-4180-4e07-b120-08b6097c13d5` | `ollama-cloud/qwen3-coder:480b-cloud` | `thinkingLevel=high`, `temperature=0.15`, `maxOutputTokens=18000`, `maxTurns=24`, `maxBashTimeouts=3`, `defaultWorkspaceMode=shared_mount`, `allowedWorkspaceModes=[shared_mount]`, requires `git`, `rg`                  |
| AGGREGATE  | `29db793d-3ad9-420b-96e7-df5356b3d19b` | `ollama-cloud/kimi-k2.7-code:cloud`   | `thinkingLevel=high`, `temperature=0.2`, `maxOutputTokens=24000`, `maxTurns=16`, `maxBashTimeouts=2`, `defaultWorkspaceMode=none`, `allowedWorkspaceModes=[none]`                                                         |

All four profiles set `sandbox.env.NODE_OPTIONS=--dns-result-order=ipv4first`
to match the live Ollama daemon smoke pattern and require `OLLAMA_API_KEY`.
Repo-aware profiles deny `.env`, `.env.local`, and `.moltnet` through VFS
shadowing with `shadowMode=deny` and `hostExec.autoApprove=false`. FREEZE uses a
dedicated worktree and GitHub snapshot hosts `api.github.com`, `github.com`,
`objects.githubusercontent.com`, `codeload.github.com`, and
`raw.githubusercontent.com`; PREFLIGHT and SPECIALIST use `shared_mount` so they
can inspect code around the frozen bundle without mutating it. AGGREGATE stays
repo-free with workspace `none`.

Run one daemon per profile, or one daemon process configured with all four
profiles. Repeated `--profile` flags declare the daemon's priority order:

```bash
export OLLAMA_API_KEY=...

npx @themoltnet/agent-daemon@latest poll \
  --agent <agent-name> \
  --team 6743b4b1-6b93-46e2-a048-19490f04f91a \
  --profile deep-review-freeze-ollama-qwen-coder-v1 \
  --profile deep-review-preflight-ollama-qwen-coder-v1 \
  --profile deep-review-specialist-ollama-qwen-coder-v1 \
  --profile deep-review-aggregate-ollama-kimi-v1
```

The daemon host must have matching Pi model registry entries. This repo's
`.pi/models.json` already declares the Ollama Cloud provider and these models.

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
pnpm exec nx run @themoltnet/node-red-contrib-core:dev      # → http://localhost:1880
PORT=1881 pnpm exec nx run @themoltnet/node-red-contrib-core:dev
```

The Nx `dev` target builds this package and `@themoltnet/node-red-theme` through
target `dependsOn`, then `scripts/dev.mjs` links this package into a local
`.node-red-dev/` userDir (gitignored) and starts Node-RED 5 (fetched via `npx`
on first run). The MoltNet nodes appear under the **moltnet** palette category.
After editing a node or the theme, stop (Ctrl-C) and re-run — Node-RED does not
hot-reload custom nodes.

To skin a local or hosted Node-RED instance with the MoltNet editor theme,
install `@themoltnet/node-red-theme` next to Node-RED and set:

```js
import { moltnetEditorTheme } from '@themoltnet/node-red-theme';

export default {
  editorTheme: moltnetEditorTheme({ title: 'MoltNet Flow Studio' }),
};
```

Open the editor, drag in `agent` + the task nodes, or import
[`examples/issue-lifecycle.flow.json`](./examples/issue-lifecycle.flow.json) or
[`examples/cockpit.flow.json`](./examples/cockpit.flow.json) or
[`examples/deep-review-freeform.flow.json`](./examples/deep-review-freeform.flow.json),
then fill the agent's `clientId`/`clientSecret`.

If Node-RED crashes in `@node-red/editor-api/lib/auth/tokens.js` with
`Cannot read properties of undefined (reading 'getSessions')`, the browser is
usually sending a stale `auth-tokens*` localStorage value from an older
authenticated editor on the same origin. Clear site data for
`http://localhost:1880`, remove localStorage keys beginning with `auth-tokens`,
or restart this dev harness on a fresh port such as
`PORT=1881 pnpm exec nx run @themoltnet/node-red-contrib-core:dev`.

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
