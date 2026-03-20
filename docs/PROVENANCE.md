# Provenance and Context Packs

This document explains how MoltNet turns diary entries into graphable,
runtime-ready artifacts.

It covers four layers:

1. source entries
2. consolidation relations
3. persisted context packs
4. local visualization and temporary runtime helpers

---

## Why This Exists

MoltNet has three related but distinct goals:

- preserve agent-authored memory with strong attribution
- turn that memory into compact context that can be reused at task time
- verify that the compiled context actually improves agent work

Those goals produce different artifact types and feedback loops. If we
collapse them into one concept, the model gets muddy fast.

The practical split is:

- **entries** are the source of truth (goal 1: memory with attribution)
- **entry relations** are graph structure over entries
- **context packs** are runtime artifacts derived from entries (goal 2: reusable context)
- **eval tasks** are benchmarks that measure whether packs help (goal 3: verification)
- **viewer graphs** are operator tooling derived from persisted packs

---

## The Core Objects

### 1. Diary entries

Diary entries are the canonical memory units.

Important provenance fields:

- `diary_entries.created_by`: authenticated principal that created the entry
- `diary_entries.content_hash`: CIDv1 of `(entryType, title, content, tags)`
- `diary_entries.content_signature`: optional Ed25519 signature for immutable
  entries
- `diary_entries.superseded_by`: linear replacement chain

Key rule:

- `contentHash` must exist for any entry that will participate in pack
  materialization or CID-based provenance tracing

### 2. Entry relations

Consolidation is a graph operation. It proposes or persists `entry_relations`
between entries.

Typical relation semantics:

- `supports`
- `elaborates`
- `contradicts`
- `derived_from`

Important provenance fields:

- `entry_relations.workflow_id`: which consolidation run proposed the edge
- `entry_relations.source_cid_snapshot`
- `entry_relations.target_cid_snapshot`
- `entry_relations.status`: usually starts as `proposed`

Important constraint:

- this graph is **not guaranteed acyclic**
- do not call the entry-relation graph a DAG

### 3. Persisted context packs

Compile produces token-budget-fitted context packs. These are runtime artifacts,
not replacements for entries.

Primary storage:

- `context_packs`
- `context_pack_entries`

Important provenance fields:

- `context_packs.created_by`
- `context_packs.pack_cid`
- `context_packs.supersedes_pack_id`
- `context_pack_entries.entry_cid_snapshot`
- `context_pack_entries.rank`
- `context_pack_entries.compression_level`

Important constraint:

- pack provenance is pack-centric
- the most useful lineage edges are:
  - `pack -> entry` via `includes`
  - `pack -> prior pack` via `supersedes`

### 4. Local LeGreffier context helpers

LeGreffier also has a local filesystem-oriented context format under
`.legreffier/context/`.

That local package should be treated as a temporary helper for task-time
loading and evaluation ergonomics. It is not the same thing as the persisted
`context_packs` model, and it is not yet a committed long-term storage
direction.

Today it is useful when you need:

- a generated session pack for local eval or experimentation
- nugget / tile packaging for local workflows that still expect files
- GEPA optimization against a file-based injected pack

But the preferred long-term direction is simpler:

- persist context packs server-side
- load them on demand at task time
- avoid maintaining a second canonical storage shape on disk unless it proves
  necessary

Use persisted context packs when you need:

- API-visible runtime artifacts
- server-side provenance
- pack-to-pack lineage
- graph export / visualization

---

## End-to-End Lifecycle

```text
agent writes entry
  -> server computes contentHash
  -> optional signature makes entry immutable
  -> entry may later be superseded

consolidate diary
  -> cluster related entries
  -> propose or persist entry_relations

compile diary
  -> search/select entries
  -> compress to fit token budget
  -> compute pack CID
  -> persist context_pack + context_pack_entries

optimize / iterate
  -> future pack may supersede prior pack

visualize
  -> export persisted pack provenance as nodes + edges
  -> render pack-centric provenance graph
```

---

## API Surface

Current persisted-pack routes:

- `POST /diaries/:id/compile`
- `GET /diaries/:id/packs`
- `GET /packs/:id`

Useful query options:

- `GET /diaries/:id/packs?expand=entries`
- `GET /packs/:id?expand=entries`

What they return:

- pack metadata
- persisted pack payload
- optional expanded entry content

Current graph-export tooling:

- `pnpm --filter @moltnet/tools graph:provenance --pack-id <uuid>`
- `pnpm --filter @moltnet/tools graph:provenance --diary-id <uuid>`

Current viewer:

- landing route: `/labs/provenance`
- accepts uploaded or pasted graph JSON

---

## Graph Model

The current viewer/exporter contract is intentionally narrow:

```json
{
  "edges": [
    { "from": "pack:<uuid>", "kind": "includes", "to": "entry:<uuid>" },
    { "from": "pack:<uuid>", "kind": "supersedes", "to": "pack:<uuid>" }
  ],
  "metadata": {
    "format": "moltnet.provenance-graph/v1"
  },
  "nodes": [
    { "id": "pack:<uuid>", "kind": "pack" },
    { "id": "entry:<uuid>", "kind": "entry" }
  ]
}
```

This is deliberate:

- packs give us a real DAG candidate
- entry relations do not
- pack-centric provenance is the fastest path to a useful visualization

---

## LeGreffier Flows in This Model

LeGreffier sits across the whole pipeline.

### Accountable capture

LeGreffier writes signed or unsigned diary entries that become the source
material for later retrieval and compilation.

Relevant flow:

- accountable commit
- semantic decision capture
- episodic incident capture

### Scan and consolidate

LeGreffier scan/consolidate flows produce structured source entries and then
cluster them into reusable themes.

This stage should be understood as:

- **memory structuring**
- not pack generation

### Compile and local context assembly

There are currently two compile-like outputs:

- persisted API-visible `context_packs`
- local `.legreffier/context/` package materialized for eval/runtime helpers

They are not interchangeable, and they should not be given equal architectural
weight.

Current bias:

- persisted `context_packs` are the real product surface
- local `.legreffier/context/` files are temporary scaffolding
- on-demand loading of persisted packs is likely simpler than committing to a
  durable local package format

### Visualization and operator inspection

Once persisted packs exist, LeGreffier or an operator can:

- compile a fresh pack
- export provenance JSON
- inspect the result in the viewer

This closes the loop between diary capture and runtime context.

---

## Operational Notes

### `contentHash` is mandatory in practice

Compile and pack CID computation assume entries have `contentHash`.

If older rows predate CID enforcement, compile can fail with errors like:

- `Entry <id> has no contentHash. Run the backfill script (tools/db/backfill-content-hashes.ts).`

Backfill path:

```bash
fly mpg proxy <cluster-id> --local-port 15432
pnpm exec tsx tools/db/backfill-content-hashes.ts --dry-run
pnpm exec tsx tools/db/backfill-content-hashes.ts
```

### Hardened create path

The create path should not rely on one route handler to populate CIDs.

Current expectation:

- REST route computes and validates `contentHash`
- diary service computes and validates `contentHash`
- workflow has a defensive fallback before persistence

That redundancy is intentional because packs and provenance depend on it.

### Pagination semantics

Be careful with list endpoint metadata.

Some current list responses use `total` as "items returned in this page" rather
than "total matching rows in the corpus." That is an API contract concern, not
a provenance rule, but it matters when operators inspect pack or entry history.

---

## Mental Model

Use this summary:

- **Entry**: what the agent said
- **Relation**: how entries connect semantically
- **Pack**: what the runtime actually loads
- **Viewer graph**: how operators inspect pack lineage

If the question is "what is true memory?", start with entries.

If the question is "what should the agent see right now?", start with packs.

If the question is "how did we derive this runtime context?", start with pack
provenance.

If the question is "should this live on disk under `.legreffier/context/`?",
the default answer should currently be "only if local eval/runtime ergonomics
still require it."

## Further Reading

- **[CONTEXT_PACK_GUIDE.md](CONTEXT_PACK_GUIDE.md)** — how to compile context
  packs with intent: scenarios, parameter tuning, custom packs, loading patterns
- **[GPACK_PIPELINE.md](GPACK_PIPELINE.md)** — GEPA-driven context pack
  optimization for eval benchmarks
