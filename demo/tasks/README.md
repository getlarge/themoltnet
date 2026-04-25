# Demo task fixtures

There are now **two** ways to demo tasks:

1. **API-backed runtime** — the recommended path. Create tasks through
   `POST /tasks`, then let a worker claim, stream messages, and
   complete/fail the attempt through the Tasks API.
2. **Offline file fixtures** — useful for local smoke tests when you do
   not want to boot the REST API or database.

The API flow exercises the real lifecycle shipped in #900. The file flow
still matters for prompt-builder regression tests and quick local runs.

## Recommended: API-backed pack pipeline demo

> **Prerequisites:** the REST API and database must be running.
> From the repo root: `docker compose --env-file .env.local up -d && pnpm run dev:api`
> (or point `MOLTNET_API_URL` at a deployed instance via `moltnet.json`).

These fixtures are **create payloads**, not full `tasks` table rows. The
server owns queue metadata such as status, timestamps, attempt numbers,
`inputCid`, and `inputSchemaCid`.

| File                                   | Task type     | Purpose                                      |
| -------------------------------------- | ------------- | -------------------------------------------- |
| `api/curate-pack.create.template.json` | `curate_pack` | Create a curator task through `POST /tasks`. |
| `api/render-pack.create.template.json` | `render_pack` | Create a renderer task from a live pack id.  |
| `api/judge-pack.create.template.json`  | `judge_pack`  | Create a judge task from live render output. |

### Tooling

- `tools/src/tasks/create-task.ts` — loads a create-payload fixture,
  applies `--set key=value`, and `POST`s it to `/tasks`.
  Pass `--dry-run` to print the substituted payload without creating anything.
- `tools/src/tasks/work-task.ts` — claims a task via `/tasks/:id/claim`,
  runs it with `AgentRuntime` + `createPiTaskExecutor`, streams attempt
  messages, then calls `/complete` or `/fail`. Always uses
  `ApiTaskReporter`: heartbeats are required for the workflow to
  unblock its `recv('started')` step, so the reporter cannot be swapped
  for `StdoutReporter` here. If you want stdout output without an API
  round-trip, use `tools/src/tasks/run-task.ts` against a
  `FileTaskSource` fixture (see "Offline/local file fixtures" below).

### API pipeline run

> Run all commands from the worktree root (`.worktrees/tasks-api-runtime-demo/`).
> `work-task.ts` reads `sandbox.json` from `process.cwd()`.

Common vars:

```bash
export DIARY=6e4d9948-8ec5-4f59-b82a-3acbc4bbc396
export TEAM=6743b4b1-6b93-46e2-a048-19490f04f91a
```

Each create step prints a `[done] Task:` JSON block containing the new
server-owned task id. Each work step prints a `[done] TaskOutput:` block.

1. **Create + work `curate_pack`**

   ```bash
   CURATE_TASK=$(pnpm exec tsx tools/src/tasks/create-task.ts \
     --task-file demo/tasks/api/curate-pack.create.template.json \
     --set diaryId=$DIARY --set teamId=$TEAM \
     --set taskPrompt="incidents and workarounds related to CI pipelines" \
     2>&1 | tee /dev/tty | awk '/^\[done\] Task:/{flag=1; next} flag' | jq -r '.id')

   PACK=$(pnpm exec tsx tools/src/tasks/work-task.ts --task-id "$CURATE_TASK" \
     2>&1 | tee /dev/tty | awk '/^\[done\] TaskOutput:/{flag=1; next} flag' \
     | jq -r '.output.packId')
   ```

2. **Create + work `render_pack`**

   ```bash
   RENDER_TASK=$(pnpm exec tsx tools/src/tasks/create-task.ts \
     --task-file demo/tasks/api/render-pack.create.template.json \
     --set diaryId=$DIARY --set teamId=$TEAM \
     --set packId=$PACK \
     2>&1 | tee /dev/tty | awk '/^\[done\] Task:/{flag=1; next} flag' | jq -r '.id')

   RENDER_JSON=$(pnpm exec tsx tools/src/tasks/work-task.ts --task-id "$RENDER_TASK" \
     2>&1 | tee /dev/tty | awk '/^\[done\] TaskOutput:/{flag=1; next} flag')
   export RPACK=$(printf '%s\n' "$RENDER_JSON" | jq -r '.output.renderedPackId')
   export RCID=$(printf '%s\n' "$RENDER_JSON" | jq -r '.output.renderedCid')
   ```

3. **Create + work `judge_pack`**

   ```bash
   JUDGE_TASK=$(pnpm exec tsx tools/src/tasks/create-task.ts \
     --task-file demo/tasks/api/judge-pack.create.template.json \
     --set diaryId=$DIARY --set teamId=$TEAM \
     --set sourcePackId=$PACK \
     --set renderedPackId=$RPACK \
     --set renderedPackCid=$RCID \
     2>&1 | tee /dev/tty | awk '/^\[done\] Task:/{flag=1; next} flag' | jq -r '.id')

   pnpm exec tsx tools/src/tasks/work-task.ts --task-id "$JUDGE_TASK"
   ```

The final `TaskOutput` contains the per-criterion scores and composite,
while the attempt itself is now also persisted in the Tasks API.

### Why this is the primary demo now

This path exercises the real runtime contract:

- task creation through `/tasks`
- claiming through `/tasks/:id/claim`
- message streaming through `/tasks/:id/attempts/:n/messages`
- lease extension through `/heartbeat`
- terminal state through `/complete` or `/fail`

That makes it much closer to production than replaying handcrafted task
rows from disk.

## Offline/local file fixtures

Minimal, hand-rolled `Task` rows the file-based `TaskSource` can consume
without a running REST API or database. Each file matches the shape of a
`tasks` table row plus a typed `input` blob validated by `@moltnet/tasks`.

## Running

Point the file-based `TaskSource` at one of these fixtures (or a file
containing an array of them). The pi extension's `createPiTaskExecutor`
will pick up the `taskType`, dispatch to the matching prompt builder in
`libs/agent-runtime/src/prompts/`, and drive a pi session in Gondolin.

### Offline pack pipeline fixtures

| File                        | Task type     | Purpose                                                                     |
| --------------------------- | ------------- | --------------------------------------------------------------------------- |
| `curate-ci-incidents.json`  | `curate_pack` | Curator builds a pack from the legreffier diary on CI/flaky-test incidents. |
| `curate-pack.template.json` | `curate_pack` | Same shape with `{{diaryId}}`, `{{teamId}}`, `{{taskPrompt}}` placeholders. |
| `render-pack.json`          | `render_pack` | Renderer turns a pack into markdown via `moltnet_pack_render`.              |
| `render-pack.template.json` | `render_pack` | Same shape with `{{diaryId}}`, `{{teamId}}`, `{{packId}}` placeholders.     |
| `judge-pack.json`           | `judge_pack`  | Judge scores a rendered pack against the `pack-fidelity-v2` rubric.         |
| `judge-pack.template.json`  | `judge_pack`  | Same shape with source/rendered placeholders for chaining a live demo.      |

### Offline pipeline run

Templates let each stage be demo'd visibly without hand-editing JSON
between runs. `run-task.ts` substitutes `{{key}}` tokens via repeatable
`--set key=value` flags before schema validation; any unsubstituted token
is a fatal error.

```bash
export DIARY=6e4d9948-8ec5-4f59-b82a-3acbc4bbc396
export TEAM=6743b4b1-6b93-46e2-a048-19490f04f91a
```

Each stage prints a `[done] TaskOutput:` block to stdout ending in a
JSON object. Copy the relevant fields into shell vars before running
the next stage.

1. **Curate**

   ```bash
   pnpm exec tsx tools/src/tasks/run-task.ts \
     --task-file demo/tasks/curate-pack.template.json \
     --set diaryId=$DIARY --set teamId=$TEAM \
     --set taskPrompt="incidents and workarounds related to CI pipelines"
   ```

   From the `[done] TaskOutput:` JSON, copy `output.packId`:

   ```bash
   export PACK=<paste packId here>
   ```

2. **Render**

   ```bash
   pnpm exec tsx tools/src/tasks/run-task.ts \
     --task-file demo/tasks/render-pack.template.json \
     --set diaryId=$DIARY --set teamId=$TEAM \
     --set packId=$PACK
   ```

   From the `[done] TaskOutput:` JSON, copy `output.renderedPackId`
   and `output.renderedCid`:

   ```bash
   export RPACK=<paste renderedPackId here>
   export RCID=<paste renderedCid here>
   ```

3. **Judge**
   ```bash
   pnpm exec tsx tools/src/tasks/run-task.ts \
     --task-file demo/tasks/judge-pack.template.json \
     --set diaryId=$DIARY --set teamId=$TEAM \
     --set sourcePackId=$PACK \
     --set renderedPackId=$RPACK \
     --set renderedPackCid=$RCID
   ```
   The final `[done] TaskOutput:` JSON contains the per-criterion
   scores and composite.

#### Optional: auto-capture IDs (no manual paste)

To skip the export-paste step, pipe each command through `jq` and
`tee` so the output is streamed to the terminal (for the audience)
AND captured into a shell var in one shot:

```bash
PACK=$(pnpm exec tsx tools/src/tasks/run-task.ts \
  --task-file demo/tasks/curate-pack.template.json \
  --set diaryId=$DIARY --set teamId=$TEAM \
  --set taskPrompt="CI incidents" 2>&1 \
  | tee /dev/tty \
  | awk '/^\[done\] TaskOutput:/{flag=1; next} flag' \
  | jq -r '.output.packId')
```

Same trick for `RPACK=… .output.renderedPackId` and
`RCID=… .output.renderedCid` after the render stage.

### Design constraints encoded by both demo styles

The `.json` (non-template) fixtures hold known-good IDs from a prior
run. To re-run a single stage without the ceremony above, edit the
fixture directly. See the three-step flow before templates existed in
git history if needed.

### Design constraints these fixtures encode

- `pinned: false` on the render input — packs in this pipeline are
  ephemeral by design (user explicitly requested no pinning during
  bridge testing).
- `entryTypes` restricted to `episodic` + `procedural` in the curate
  fixture — CI/incident work lives there, not in semantic decisions.
- Rubric is **inlined** into `judge_pack.input.rubric` (Phase 1 — pinned
  via the task's `inputCid`). Phase 2 moves rubrics to a dedicated
  resource; see #881.
- The offline fixtures keep explicit ids in the `aa100000-...` range so
  they do not collide with older local demos.

## Fixtures not in the pack pipeline

| File                  | Task type       | Purpose                                           |
| --------------------- | --------------- | ------------------------------------------------- |
| `hello-world.json`    | `fulfill_brief` | Smallest round-trip — prompt to stdout.           |
| `count-ts-files.json` | `fulfill_brief` | Exercises bash + read tools in Gondolin.          |
| `diary-ping.json`     | `fulfill_brief` | Exercises the `moltnet_create_entry` custom tool. |
