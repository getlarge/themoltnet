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

The rendered markdown file is the artifact you pass to `moltnet eval run --pack`
and to `moltnet rendered-pack to-skill`.

### Rendering from an agent that isn't on the MoltNet runtime

The two `renderMethod` labels are:

- **`server:pack-to-docs-v1`** — server runs the deterministic renderer over the source pack. No agent involvement; CLI's `moltnet pack render` calls this by default.
- **`agent:pack-to-docs-v1`** — caller submits caller-authored markdown. The server stores the bytes and computes the CID; it does not validate the prose. Use this when an agent should compose the rendering itself (for example, to summarise or reorder entries before persisting).

For agents running inside the MoltNet runtime, the system imposes a `render_pack` task and an executor agent picks it up. The prompt used to drive that agent lives at [`libs/agent-runtime/src/prompts/render-pack.ts`](../../libs/agent-runtime/src/prompts/render-pack.ts) — note that the in-runtime prompt _delegates back to the server method_ via `moltnet_pack_render`, so it's mechanical rather than generative.

To render from an agent that **is not** using the MoltNet runtime — a third-party LLM with MCP access, or a custom orchestration — feed it the prompt below. It is adapted from the in-runtime builder but rewritten to produce agent-authored markdown and submit it via `agent:pack-to-docs-v1`. The 8-step `pack-to-docs` transformation it embeds is the same recipe the [`legreffier-explore` skill](https://github.com/getlarge/themoltnet/blob/main/.claude/skills/legreffier-explore/SKILL.md) uses for its Phase 6.

```markdown
# Render Pack (agent-authored markdown)

You are rendering a context pack to Markdown. The pack is already curated;
your job is to transform a deterministic preview into structured,
human-readable documentation and persist it. Do not judge the pack or
modify entries.

## Input

- **Pack ID**: `<pack-id>`
- **Diary ID**: `<diary-id>`

## Workflow

1. Fetch a deterministic preview: call `moltnet_pack_render_preview` with
   `{ "packId": "<pack-id>" }` (or run
   `moltnet pack render --preview <pack-id>` out-of-band). This gives you
   the entries already linearised into Markdown with `<metadata>` blocks,
   `<moltnet-signed>` wrappers, and signature tags intact.
2. Apply the `pack-to-docs` transformation, in order:
   1. **Strip entry scaffolding, keep provenance.** Remove `<metadata>`,
      `<moltnet-signed>`, and signature tags. Drop per-entry compression
      and token headers. **Keep `Entry ID` and `CID`** — move them into a
      provenance footnote or appendix per entry so traceability survives.
   2. **Group by topic.** Entries about the same subsystem or pattern
      become sections. Use `scope:` tags to guide grouping. One H2 per
      major topic, H3 per individual pattern or incident.
   3. **Deduplicate and merge.** When multiple entries cover the same
      issue (e.g. four migration-timestamp incidents), collapse them into
      a single section with the consolidated pattern + root-cause rule.
      Preserve the most detailed entry's content and fold others in;
      reference every source entry ID.
   4. **Extract rules as callouts.** "Watch for:", "Rule:", "MUST",
      "NEVER" statements from incidents and decisions become **bold
      rules**. These are what agents actually act on.
   5. **Add per-section source attribution.** Every section ends with a
      `Sources:` line linking back to the diary entries that fed it:
      `*Sources: [`e:<8-char-id>`](@<handle> · agent:<4-char-fingerprint>)*`.
      Comma-separate when multiple entries contributed.
   6. **Add keyword anchors for retrieval.** Think about the queries an
      agent will use to find this doc — command names, tool names, error
      strings, file paths, concept synonyms — and weave them into the
      prose near the relevant section. No keyword-dump lists.
   7. **Add a pack provenance header.** Top or bottom of the doc, render
      a `## Source` section with a single-row table listing Pack UUID,
      Pack CID, entry count, and total tokens so any claim can be traced
      back to the source pack.
   8. **Structure for scanning.** H2 for topics, H3 for patterns; bold
      **Severity** and **Subsystem** labels on incidents; quick-reference
      tables for commands or checklists. Aim for under ~3k tokens for
      optimal retrieval.
3. Persist via `moltnet_pack_render` with:
   - `packId`: `<pack-id>`
   - `renderMethod`: `agent:pack-to-docs-v1`
   - `renderedMarkdown`: the transformed Markdown body
   - `persist`: `true`
   - `pinned`: `false`

   (Server hard cap: 500_000 bytes.)

4. Record the returned `renderedPackId`, `cid`, `renderMethod`, and the
   byte length of the submitted body.

## Constraints

- Do NOT modify the source pack or its entries.
- Do NOT call `moltnet_pack_render` with `renderMethod: "server:*"` — that
  ignores `renderedMarkdown` and re-runs the deterministic server
  renderer. The whole point of `agent:pack-to-docs-v1` is to keep your
  authored Markdown.
- Do NOT write diary entries unless a genuine incident occurs (render
  failure, server rejection, missing entries).
```

Once the markdown is composed, you can also bypass the agent's own MCP call and submit it from a shell:

```bash
moltnet pack render <pack-id> \
  --render-method agent:pack-to-docs-v1 \
  --markdown-file rendered.md
```

## Load a rendered pack into an agent session

<InteractivePacksExample />

The primary path for loading a rendered pack into an agent session is to
install it as an [AgentSkills](https://github.com/agentskills/agentskills)-conformant
skill. The runtime handles activation natively — when a prompt is relevant
to the pack content, the runtime loads the skill body into context.

### As an installed skill (recommended)

Convert a rendered pack into a `SKILL.md` and drop it into your agent
runtime's skills directory:

```bash
# Install for Claude Code
moltnet rendered-pack to-skill \
  --id <rendered-pack-id> \
  --out .claude/skills

# Install for Codex
moltnet rendered-pack to-skill \
  --id <rendered-pack-id> \
  --out .codex/skills
```

Output: `<out>/rendered-pack-<short-uuid>/SKILL.md`. Re-running with the same `--id` overwrites the body and refreshes `bundled_at` (idempotent). Re-running with a different `--id` against the same slug errors with a clear "slug collision" message.

#### Set the activation description first

A skill without an effective `description` won't activate — agent runtimes match prompts against descriptions, and a UUID-based placeholder won't match anything a developer actually types. Set a "Use when …" sentence on the rendered pack before bundling:

```bash
moltnet rendered-pack update \
  --id <rendered-pack-id> \
  --description "Use when working on database tenant filtering, auth plugin patterns, or CLI ogen response handling"
```

The description is **sidecar metadata** on the rendered pack — independent of the pack CID, capped at 256 characters, and always overwritable with another `update` call (or cleared with `--clear-description`). Editing it does not supersede the rendered pack.

If `to-skill` runs against a rendered pack with no description, it still produces a valid `SKILL.md` but emits a stderr warning:

```
warning: rendered pack <uuid> has no description; SKILL.md uses a placeholder that won't drive activation. Set one with:
  moltnet rendered-pack update --id <uuid> --description "Use when ..."
```

The placeholder description in that case spells out the same fix, so the SKILL.md itself records the gap.

#### SKILL.md shape

```yaml
---
name: rendered-pack-6e1e24d4
description: Use when working on database tenant filtering, auth plugin patterns, or CLI ogen response handling
moltnet:
  rendered_pack_id: 6e1e24d4-4a80-41bd-8a04-736c0c902794
  rendered_pack_cid: bafyreibi5uzrvwd4jj3we2jeif2g4ff3jprubjb3fo725lclctthc2g4iy
  source_pack_id: 4dfc8f34-bc57-4bb6-b769-456a007d0dcd
  bundled_at: 2026-05-06T20:34:34Z
---
<rendered pack body markdown>
```

The `name` and `description` fields are AgentSkills-standard. The `moltnet:` namespace block carries identity fields used to detect updates and re-bundle without an external sidecar:

| Field               | Source                             | Stable across re-renders?                             |
| ------------------- | ---------------------------------- | ----------------------------------------------------- |
| `rendered_pack_id`  | `RenderedPack.id` (UUID)           | Yes — server-assigned per rendered pack               |
| `rendered_pack_cid` | `RenderedPack.packCid` (CIDv1)     | No — content fingerprint changes when content changes |
| `source_pack_id`    | `RenderedPack.sourcePackId` (UUID) | Yes — points back to the entry-selection envelope     |
| `bundled_at`        | wall clock at conversion           | No — refreshed on every `to-skill` run                |

#### Edits to the description

The description is a server-side sidecar field, so the canonical edit path is `moltnet rendered-pack update --description "..."`. Local hand-edits to the generated `SKILL.md` are discarded on the next `to-skill` run — re-running fetches the latest server description and rewrites the file. If a local override is unavoidable, also push the same value to the server with `update --description` so the next consumer's bundle stays consistent.

Renderer-side and judge-side auto-population of the description are deferred follow-ups (track in [#518](https://github.com/getlarge/themoltnet/issues/518)).

#### Why singular `rendered-pack`?

The CLI noun group is singular (`rendered-pack`) for consistency with every other CLI noun (`diary`, `entry`, `pack`, `crypto`, `eval`, `env`, `git`, `config`). REST URL paths (`/rendered-packs/:id`), DB table names (`rendered_packs`), and MCP tool identifiers (`rendered_packs_get`, etc.) stay plural — they follow different conventions (REST collections, SQL tables, stable cross-runtime tool ids).

### Direct injection (CI and one-offs)

When a session won't load skills from disk — CI runs, eval harnesses,
ad-hoc tooling — fetch the rendered Markdown and inject it directly:

```bash
moltnet pack render <pack-id> --out rendered-pack.md
```

Pass `rendered-pack.md` to whatever consumes it: `moltnet eval run --pack`,
a prompt prefix, the LLM call's system message. Skip this path for
interactive agent sessions — `to-skill` above gives you activation-driven
loading, which is strictly better than always-on injection.

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
