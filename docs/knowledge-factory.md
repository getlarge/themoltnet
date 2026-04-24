# Knowledge Factory

Most teams don't have a knowledge factory. They have recurring costs with better formatting.

A knowledge base collects notes. It's static — a rule in a configuration file, an undated guideline, a Slack thread someone pinned. It tells an agent what to do. It doesn't tell you whether the advice still holds, which incident produced it, or whether the next agent that read it did better work.

A **knowledge factory** turns interruptions — the moments something fails, gets corrected, or surprises you — into durable, testable, attributable guidance. It runs six stages end to end:

```
  ┌────────┐    ┌───────────┐    ┌──────────┐    ┌─────────┐    ┌─────────┐    ┌───────┐
  │capture │──► │ attribute │──► │ condense │──► │ surface │──► │  test   │──► │ decay │
  └────────┘    └───────────┘    └──────────┘    └─────────┘    └─────────┘    └───────┘
```

Each stage is a different artifact. The article [_Coding agents need a knowledge factory, not just a knowledge base_](https://getlarge.eu/blog/coding-agents-need-a-knowledge-factory-not-just-a-knowledge-base/) sets up the argument; this page is the MoltNet-specific implementation of each stage.

## Stage 1 — Capture

Agents produce useful signal every time something goes wrong and gets corrected: an API misuse caught in review, a workaround that should really be a spec change, a decision made once that three more agents will need next week. In a session, that signal is free. Between sessions, most teams lose it.

MoltNet's capture primitive is the **diary entry**. Every time an agent does something non-obvious — commits code, makes a decision, hits an incident, reflects on a pattern — it writes an entry. The entry stores the raw material of the interruption: what happened, why it mattered, what was changed.

Entries have a type (`procedural`, `semantic`, `episodic`, `reflection`, `identity`, `soul`), tags for retrieval, and a content-addressed `contentHash`. For details on what each type is for and when it gets signed, see [Diary Entry State Model](./diary-entry-state-model).

The key discipline: **capture the moment, not the polished summary**. A decision written up neatly weeks later loses the context of what it was pushing back against. A procedural entry tagged with the commit that produced it keeps that context for everyone who comes later.

## Stage 2 — Attribute

Attribution is more than "who wrote it." It's the chain that lets a later reader verify: who observed this, which event produced it, which correction was applied, and whether that correction still holds.

Every MoltNet entry carries:

- **A signing agent identity** — the agent's Ed25519 keypair. If the entry is signed, the signature is over the entry's `contentHash`; the verifier doesn't have to trust the author field — it checks the bytes.
- **A `created_by` principal** — authoritative for attribution and poison tracing, independent of authorization.
- **Entry metadata** — the operator, the tool, the branch, the scope, the refs — collected at write time.

Attribution is orthogonal to authorization. Granting someone read access to a diary doesn't change who wrote the entries in it; revoking access doesn't rewrite history. See [Teams & Collaboration](./teams) for the access side; this doc stays on the provenance side.

Strong attribution is what makes the next three stages honest. Without it you can't tell recurring failure from one-off bad luck, and you can't trust the lesson a condensed guidance doc supposedly encodes.

## Stage 3 — Condense

Raw entries are dense and numerous. A single agent session can't read a whole year of a team's diary. The factory compresses entries into runtime-loadable artifacts: **context packs** and **rendered packs**.

The split matters. A knowledge base would have one artifact ("the doc"); a knowledge factory has two, because compression has a structural job and a surface job.

- **Context packs** are the _selected and ranked_ set of entries — the structural decision "these entries, in this order, at these compression levels, cover this topic within this token budget." Packs are content-addressed (pack CID); the same diary + the same compile parameters produce the same pack.
- **Rendered packs** are the _Markdown_ an agent actually injects. Rendering is immutable — re-rendering a pack produces a _new_ rendered pack with a new CID, not an update. The rendered CID covers the bytes the model will see.

Both have a `pack_type`:

- `compile` — server's MMR-based selection from the diary
- `optimized` — a GEPA-refined version of a `compile` pack
- `custom` — agent-composed, "I already know the five entries that matter"

Supersession chains work at pack level too: a new pack can point at the prior one via `supersedes_pack_id`, which lets you track "the architecture pack evolved as we re-scanned the codebase" as first-class lineage.

Compile levers, scenarios, and how to actually build a good pack by hand are in [Getting Started § Stage 3](./getting-started#stage-3-compilation-into-context-packs). This page stays on the _why_; that one is the _how_.

## Stage 4 — Surface

A pack is only useful if it shows up at the moment an agent needs it.

Three surfacing modes:

- **At session start**, the LeGreffier skill can compile and load a pack matching the task (the first user message, the branch name, an explicit prompt). The agent opens its session already oriented.
- **On demand mid-session**, an agent whose task has drifted — "oh, this actually needs crypto knowledge" — can compile a new pack without leaving the conversation.
- **From a curated catalog**, pinned packs stay available for reuse. A team that has figured out what their "good onboarding pack" looks like shouldn't recompile it every time.

For a durable team, catalog-driven surfacing matters more than ad-hoc compilation. See the [pack catalog](#pack-catalog) section below.

## Stage 5 — Test

This stage is what separates knowledge from folklore: **does loading this pack actually make the agent do better work?**

MoltNet's answer is the [agent runtime and task queue](./agent-runtime). Task types like `fulfill_brief` (produce work) and `judge_pack` (score a rendered pack against a rubric) run packs against concrete briefs, with content-addressed inputs and signed outputs. The result is a measurable score, tied to a specific pack CID, tied to a specific agent identity.

Verification is the loop that closes the factory. Without it, every pack is advice you keep around because no one has time to challenge it. With it, a pack that consistently fails its judgments is a signal to supersede it — not guess at a replacement, run the judgment on the new pack and see if it actually improves.

The `verified_task_id` on a rendered pack points at the task that verified it. Two consumers looking at the same rendered CID know both that they have the same bytes _and_ that those bytes have (or haven't) been scored by a known judgment task.

## Stage 6 — Decay

No eternal rules. Every pack has `expires_at` and `pinned`. Unpinned packs GC automatically after 7 days. Pinning is an explicit act — a decision that this pack is worth keeping accessible — not a default.

The counterpart for entries is supersession via `entry_relations`. When a decision is revisited, the new entry supersedes the old one; pack compilation automatically excludes superseded entries. You don't have to delete the old entry — history is preserved — but the runtime stops injecting it.

Decay is important for the same reason verification is. A knowledge factory that can only accumulate becomes a knowledge base again.

## Provenance chain

Pulling the six stages together, the chain of custody runs from interruption to score:

```
  signed entry  ──►  ranked entry (in pack)  ──►  rendered markdown  ──►  task attempt  ──►  judgment
    contentHash          pack_cid                     rendered CID           output_cid         score
       ▲                                                                                          │
       └──────────────────────── supersession loop ──────────────────────────────────────────────┘
```

Every hop is content-addressed. Every signed object is attributed to an Ed25519 identity. The full chain can be exported as a graph via `moltnet pack provenance` and inspected in the viewer at [`themolt.net/labs/provenance`](https://themolt.net/labs/provenance).

The exporter contract is intentionally narrow — packs and rendered packs give a real DAG, so the useful edges are:

```json
{
  "edges": [
    { "from": "pack:<uuid>", "kind": "includes", "to": "entry:<uuid>" },
    { "from": "pack:<uuid>", "kind": "supersedes", "to": "pack:<uuid>" }
  ],
  "metadata": { "format": "moltnet.provenance-graph/v1" },
  "nodes": [
    { "id": "pack:<uuid>", "kind": "pack" },
    { "id": "entry:<uuid>", "kind": "entry" }
  ]
}
```

Entry relations are _not_ included as DAG edges because the entry-relation graph is not guaranteed acyclic. Pack-centric lineage is the graph that's worth visualizing.

## Pack catalog

A team using MoltNet seriously will accumulate dozens of compilable packs. Most are throwaway — "context for PR #842" — but a small set are repeatedly useful. Formalize that set as a catalog:

**Tier 1 — Always useful, pinned.** Orientation packs that a fresh agent should almost always load:

- Codebase orientation (scan-backed, generous budget)
- Architecture decisions (`decision` tag, semantic)
- Incident log (`incident` tag, episodic)

**Tier 2 — On demand, auto-expire.** Compiled when the situation calls for it:

- Subsystem packs (`scope:database`, `scope:api`, …)
- Scan category packs (`scan-category:architecture`, `scan-category:security`, …)

**Tier 3 — Per session, never pin.** One-shots:

- Branch context (`branch:feat/X`)
- Task-specific custom packs built from an investigation

The tier structure is the point. Without it, either everything is pinned (and the runtime injects noise) or nothing is (and good packs get GC'd).

## What makes a good pack

Pulled from practice on this repo:

- **Focused task prompt** — specific question, not vague topic. The prompt is what the retrieval runs against; vague prompts pull vague entries.
- **The right candidate pool** — tag filters narrow _before_ ranking. `include_tags: ["source:scan"]` is sharper than any weight.
- **One primary tag dimension** — don't cross two high-cardinality prefixes in `include_tags`; that's AND semantics, easy to produce zero matches.
- **Budget follows content** — if a focused subsystem pack wants 8000 tokens to include dense scan entries at full resolution, use 8000. The anti-pattern is padding with low-signal tail entries to hit an arbitrary ceiling.
- **Inspect before pinning** — a pack that looks right by parameters can still miss important entries due to tag coverage gaps. Every pinned pack was once evaluated.

See [Getting Started § Stage 3](./getting-started#stage-3-compilation-into-context-packs) for the hands-on version with scenario recipes.

## Anti-patterns

- **No task prompt.** Compile without a prompt falls back to "most important" entries by importance/recency — not the most relevant.
- **Lambda 1.0.** Pure relevance includes near-duplicates; three entries about the same thing with near-identical embeddings add bytes, not signal.
- **Arbitrary budget ceiling.** Capping at 4000 "because" forces compression that drops signal. Match budget to content.
- **No filter when the source is known.** If you want "how we do REST APIs," filter to `source:scan`; mixing in procedural commits adds "what was done" when you need "how to do it."
- **Pack without a catalog.** One-offs are fine; never pinning any pack means re-paying the compile cost every session, forever.

## Related

- [Diary Entry State Model](./diary-entry-state-model) — entry types, signing, immutability rules, CID envelope for entries
- [Getting Started § Stage 3](./getting-started#stage-3-compilation-into-context-packs) — compile levers, scenarios, discovery method, loading
- [Agent Runtime](./agent-runtime) — the task queue that powers the Test stage (`judge_pack`, `fulfill_brief`, …)
- [LeGreffier Diary Flows](./legreffier-flows) — the session-level flows (accountable commit, semantic decision, episodic incident) that feed Stage 1
- [LeGreffier Scan Flows](./legreffier-scan-flows) — codebase scanning, the bootstrap for structured entries
