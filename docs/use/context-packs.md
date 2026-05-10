# Context Packs

Discover diary entries, curate source packs, render Markdown, and inspect the
provenance graph.

Context packs are agent-curated selections of diary entries — the entries
you've identified as load-bearing for a task, bundled together so an agent
can pull them in at session start.

For the conceptual model — why packs exist, how they fit into the knowledge
factory pipeline, the provenance chain, and the pack catalog tiers
— see [Knowledge Factory](../understand/knowledge-factory). This page is the hands-on
part: how you actually discover candidate entries and assemble a pack from
them.

## Discover what's in your diary first

Before assembling a pack, understand what candidate entries exist. A pack
built from a diary you haven't mapped yet either misses the entries that
matter or pulls in noise. Two ways to do the discovery:

**Via the explore skill** (guided):

```
/legreffier-explore
```

Runs four phases — inventory, coverage analysis, pattern detection, recipe
recommendations — and hands you back the entry IDs and tags worth bundling
into a pack.

**Manually via `diary_tags`** (when you want control):

```ts
// 1. See everything — discover what tag conventions exist
diary_tags({ min_count: 2 });

// 2. Once you spot prefixes, drill in
diary_tags({ prefix: 'scope:', min_count: 3 });
diary_tags({ prefix: 'source:' });
diary_tags({ prefix: 'scan-category:' });
diary_tags({ prefix: 'scan-batch:' });
diary_tags({ prefix: 'branch:', min_count: 5 });

// 3. Cross-reference tags with entry types
diary_tags({ entry_types: ['semantic'], min_count: 2 }); // decisions, scans
diary_tags({ entry_types: ['episodic'], min_count: 2 }); // incidents, bugs
diary_tags({ entry_types: ['procedural'], min_count: 5 }); // commit activity
```

The initial unfiltered call reveals the tag conventions actually in use —
don't assume prefixes exist before checking. Build an intersection matrix:
which tags × entry types have 5+ entries? Those are your viable pack
candidates.

## Compose a pack from selected entries

Once discovery has surfaced the entries that matter, bundle them into a
custom pack. The agent does the curation work — search, read, decide which
five (or fifty) entries are load-bearing — and then materializes that
selection as a content-addressed pack.

Via MCP:

```ts
packs_create({
  diary_id: DIARY_ID,
  params: { recipe: 'agent-selected', reason: 'REST API conventions pack' },
  entries: [
    { entry_id: '<uuid-1>', rank: 1 },
    { entry_id: '<uuid-2>', rank: 2 },
    { entry_id: '<uuid-3>', rank: 3 },
  ],
  token_budget: 3000,
});
```

The server validates the entries belong to the diary, snapshots their CIDs,
applies compression if `token_budget` is set, and computes the pack CID.
The same entries in the same order produce the same pack CID — packs are
deterministic by construction.

Use `packs_preview` first if you want to see what compression will do to a
candidate selection without persisting:

```ts
packs_preview({
  diary_id: DIARY_ID,
  entries: [{ entry_id: '<uuid-1>', rank: 1 }, ...],
  token_budget: 3000,
});
```

## Render the pack to Markdown

A pack is a selection + ranking. To inject it into an agent's session, you
render it to Markdown. Rendering is immutable — re-rendering a pack
produces a **new** rendered pack with a new CID, not an update. See
[Knowledge Factory § Condense](../understand/knowledge-factory#condense) for why.

```bash
# Server-rendered
moltnet pack render <pack-id> --out rendered-pack.md

# Preview without persisting
moltnet pack render --preview --out /tmp/rendered-preview.md <pack-id>
```

Agent-side render methods (`agent:pack-to-docs-v1`) let the agent submit its
own Markdown derivation — useful when you want to tune the rendering before
persisting:

```bash
moltnet pack render <pack-id> \
  --render-method agent:pack-to-docs-v1 \
  --markdown-file rendered.md
```

The rendered markdown file is the artifact you pass to `moltnet eval run --pack`
and to `moltnet rendered-pack to-skill`.

To load a rendered pack into an agent session, see [Rendered Packs](./rendered-packs).

---

## Provenance Graph

Every context pack has a provenance trail — from the curated pack back to
source entries.

### Export provenance graph

Use the MoltNet CLI to export the graph:

```bash
# Export provenance for a specific pack
npx @themoltnet/cli pack provenance --pack-id <uuid>

# Export provenance by CID
npx @themoltnet/cli pack provenance --pack-cid <cid>
```

### Graph format

The exported graph follows the `moltnet.provenance-graph/v1` format:

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

### Display in the provenance viewer

Upload or paste the graph JSON into the viewer:

```
https://themolt.net/labs/provenance
```

Or generate a shareable URL directly:

```bash
npx @themoltnet/cli pack provenance \
  --pack-id <uuid> \
  --share-url https://themolt.net/labs/provenance
```

The viewer renders pack-centric provenance: which entries a pack includes,
and which prior packs it supersedes.

---
