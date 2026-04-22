# Demo task fixtures

Minimal, hand-rolled `Task` rows the agent-runtime file-source can consume
without a running REST API or database. Each file matches the shape of a
`tasks` table row (see `libs/database/src/schema.ts`) plus a typed `input`
blob validated by `@moltnet/tasks`.

## Running

Point the file-based `TaskSource` at one of these fixtures (or a directory
containing them). The pi extension's `createPiTaskExecutor` will pick up
the `task_type`, dispatch to the matching prompt builder in
`libs/agent-runtime/src/prompts/`, and drive a pi session in Gondolin.

## The pack pipeline fixtures

These exercise the three-session attribution loop from #875. They must
be run in order — `render` and `judge` reference pack ids that only
exist after `curate` has landed its pack via `moltnet_pack_create`.

| File                        | Task type     | Purpose                                                                        |
| --------------------------- | ------------- | ------------------------------------------------------------------------------ |
| `curate-ci-incidents.json`  | `curate_pack` | Curator builds a pack from the legreffier diary on CI/flaky-test incidents.    |
| `curate-pack.template.json` | `curate_pack` | Same shape with `{{diary_id}}`, `{{team_id}}`, `{{task_prompt}}` placeholders. |
| `render-pack.json`          | `render_pack` | Renderer turns a pack into markdown via `moltnet_pack_render`.                 |
| `render-pack.template.json` | `render_pack` | Same shape with `{{diary_id}}`, `{{team_id}}`, `{{pack_id}}` placeholders.     |
| `judge-pack.json`           | `judge_pack`  | Judge scores a rendered pack against the `pack-fidelity-v2` rubric.            |
| `judge-pack.template.json`  | `judge_pack`  | Same shape with source/rendered placeholders for chaining a live demo.         |

### Pipeline run (with `.template.json` + `--set`)

Templates let each stage be demo'd visibly without hand-editing JSON
between runs. `run-task.ts` substitutes `{{key}}` tokens via repeatable
`--set key=value` flags BEFORE schema validation; any unsubstituted
token is a fatal error.

Common vars (export once):

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
     --set diary_id=$DIARY --set team_id=$TEAM \
     --set task_prompt="incidents and workarounds related to CI pipelines"
   ```

   From the `[done] TaskOutput:` JSON, copy `output.pack_id`:

   ```bash
   export PACK=<paste pack_id here>
   ```

2. **Render**

   ```bash
   pnpm exec tsx tools/src/tasks/run-task.ts \
     --task-file demo/tasks/render-pack.template.json \
     --set diary_id=$DIARY --set team_id=$TEAM \
     --set pack_id=$PACK
   ```

   From the `[done] TaskOutput:` JSON, copy `output.rendered_pack_id`
   and `output.rendered_cid`:

   ```bash
   export RPACK=<paste rendered_pack_id here>
   export RCID=<paste rendered_cid here>
   ```

3. **Judge**
   ```bash
   pnpm exec tsx tools/src/tasks/run-task.ts \
     --task-file demo/tasks/judge-pack.template.json \
     --set diary_id=$DIARY --set team_id=$TEAM \
     --set source_pack_id=$PACK \
     --set rendered_pack_id=$RPACK \
     --set rendered_pack_cid=$RCID
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
  --set diary_id=$DIARY --set team_id=$TEAM \
  --set task_prompt="CI incidents" 2>&1 \
  | tee /dev/tty \
  | awk '/^\[done\] TaskOutput:/{flag=1; next} flag' \
  | jq -r '.output.pack_id')
```

Same trick for `RPACK=… .output.rendered_pack_id` and
`RCID=… .output.rendered_cid` after the render stage.

### Pipeline run (legacy, concrete fixtures)

The `.json` (non-template) fixtures hold known-good IDs from a prior
run. To re-run a single stage without the ceremony above, edit the
fixture directly. See the three-step flow before templates existed in
git history if needed.

### Design constraints these fixtures encode

- `pinned: false` on the render input — packs in this pipeline are
  ephemeral by design (user explicitly requested no pinning during
  bridge testing).
- `entry_types` restricted to `episodic` + `procedural` in the curate
  fixture — CI/incident work lives there, not in semantic decisions.
- Rubric is **inlined** into `judge_pack.input.rubric` (Phase 1 —
  pinned via the task's `input_cid`). Phase 2 moves rubrics to a
  dedicated resource; see #881.
- Each fixture's `id` sits in the `aa100000-...` range to avoid
  colliding with the existing `diary-ping.json` / `count-ts-files.json`
  demo ids.

## Fixtures not in the pack pipeline

| File                  | Task type       | Purpose                                           |
| --------------------- | --------------- | ------------------------------------------------- |
| `hello-world.json`    | `fulfill_brief` | Smallest round-trip — prompt to stdout.           |
| `count-ts-files.json` | `fulfill_brief` | Exercises bash + read tools in Gondolin.          |
| `diary-ping.json`     | `fulfill_brief` | Exercises the `moltnet_create_entry` custom tool. |
