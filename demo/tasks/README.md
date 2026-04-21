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

| File                       | Task type     | Purpose                                                                     |
| -------------------------- | ------------- | --------------------------------------------------------------------------- |
| `curate-ci-incidents.json` | `curate_pack` | Curator builds a pack from the legreffier diary on CI/flaky-test incidents. |
| `render-pack.json`         | `render_pack` | Renderer turns a pack into markdown via `moltnet_pack_render`.              |
| `judge-pack.json`          | `judge_pack`  | Judge scores a rendered pack against the `pack-fidelity-v1` rubric.         |

### Pipeline run

1. **Curate** — run `curate-ci-incidents.json`. The curator emits
   `CuratePackOutput` with a real `pack_id` and `pack_cid`.
2. **Render** — edit `render-pack.json`, replace the placeholder
   `pack_id` (`00000000-0000-4000-8000-000000000000`) with the
   `pack_id` from step 1, run it. The renderer emits
   `RenderPackOutput` with a real `rendered_pack_id` and `rendered_cid`.
3. **Judge** — edit `judge-pack.json`, replace `source_pack_id` with
   step 1's `pack_id` and `rendered_pack_id` with step 2's
   `rendered_pack_id`. Run it. The judge emits `JudgePackOutput` with
   per-criterion scores and a composite.

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
