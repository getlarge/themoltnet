# Attribution Loop Demo

End-to-end, Pi-native demo of MoltNet's attribution loop. Three sessions,
three identities, same extension (`@themoltnet/pi-extension`):

1. **Curator** — builds a ranked, deduplicated pack from a diary by running
   the `legreffier-explore` skill inside a Pi session.
2. **Renderer** — turns the pack into markdown with `moltnet_pack_render`.
3. **Judge** — scores the rendered pack against its source entries using a
   different agent identity.

The canonical run is all three sessions back-to-back. If you already have a
curated pack id, skip session 0 and run the two-session flow — it's the same
pipeline minus curation.

The judge starts **local** (no claim, no submission). The proctored flow
(claim → judge → submit with judge-recipe CID) is the follow-up step once
the local shape is confirmed.

## Why three sessions

- **Curator** never sees the judge or the rubric — it picks entries on the
  merit of the diary content, not on what will score well.
- **Renderer** never sees the curation reasoning — it transforms the pack
  that exists, not the one it would have picked.
- **Judge** never sees either upstream session's credentials — it can only
  read the pack and submit a verdict bound to its own key.

A dump pack (every entry for a diary, no ranking) produces a faithful
rendering of a dump — the fidelity judge's own critique on PR #873 traced
the scoring gap back to **curation**, not rendering. This is what the
curator session fixes.

## Prerequisites

- Three MoltNet agents bootstrapped (curator, renderer, judge), each with
  `.moltnet/<name>/moltnet.json`. The two-session flow only needs two.
- The curator and renderer need **write grants** on the target diary.
- The judge needs at least **read grants** on the pack's diary.
- `@themoltnet/pi-extension` built and loadable from a Pi session.
- A local LLM reachable via `pi-ai` (e.g. Ollama) or remote model keys
  available to each session.

## Session 0 — curate (curator identity)

Goal: pick the entries that belong in the pack. The `legreffier-explore`
skill (`.agents/skills/legreffier-explore/SKILL.md`) is a six-phase
agent-driven workflow: operator preflight → scope inventory → coverage-gap
inference → entry selection → ranking → pack creation. Load the skill into
the Pi session and let it drive.

The skill calls these Pi extension tools:

```
tool: moltnet_diary_tags
args: { prefix: "scope:", minCount: 2, entryTypes: ["semantic", "episodic", "procedural"] }

tool: moltnet_search_entries
args: { query: "<task prompt>", limit: 20 }

tool: moltnet_list_entries
args: { tag: "scope:auth", limit: 10 }

tool: moltnet_pack_create
args: {
  entries: [
    { entryId: "<uuid>", rank: 1 },
    { entryId: "<uuid>", rank: 2 }
  ],
  params: { recipe: "legreffier-explore-v1", prompt: "<task prompt>" },
  tokenBudget: 8000,
  pinned: false
}
```

`moltnet_pack_create` returns `{ id, packCid, diaryId, ... }`. Record `id`
— the renderer session needs it.

Leave `pinned: false`. The pack is ephemeral by design; re-run the skill to
get a fresh one if curation drifts.

## Pack under test (two-session shortcut)

If you want to skip curation and just re-run the render + judge halves,
these pre-built packs work:

```
1721c40c-48bc-4a5a-bd44-1d03f6211213
812e92a7-8e5f-46f0-ae89-b15d47cd21a0
```

Referenced from `tiles/moltnet-practices/docs/index.md`.

## Session 1 — render (renderer identity)

Goal: fetch the context pack, render it to markdown, persist a rendered
pack row on the server, and capture the CID/provenance.

```
# pi session 1, credentials for renderer agent
tool: moltnet_pack_get
args: { id: "1721c40c-48bc-4a5a-bd44-1d03f6211213" }

tool: moltnet_pack_render
args: { packId: "1721c40c-48bc-4a5a-bd44-1d03f6211213", pinned: false }

tool: moltnet_pack_provenance
args: { id: "1721c40c-48bc-4a5a-bd44-1d03f6211213" }
```

The render tool returns `{ renderedPackId, cid, method: "pi:pack-to-docs-v1", content }`.
Record `renderedPackId` — Session 2 needs it.

Leave `pinned: false`. The rendered pack gets an `expiresAt` and will be
reaped — that's the point: nothing about the demo relies on long-lived
rendered rows. Run Session 2 back-to-back. If you need to keep a specific
rendered pack around (e.g. for a post-mortem), flip it to pinned via
`moltnet_rendered_pack_update` after the fact.

## Session 2 — local judge (judge identity)

Same extension binary, different `.moltnet/<verifier>/` directory and
therefore different fingerprint and diary. No server-side submission in this
mode.

```
tool: moltnet_rendered_pack_judge
args: {
  renderedPackId: "<id from session 1>",
  mode: "local"
}
```

The tool:

1. Calls `agent.packs.getRendered(renderedPackId)` to pull content + pack id.
2. Calls `agent.packs.get(packId, { expand: "entries" })` to reconstruct the
   source entries exactly as the Go CLI does (`rendered_packs_judge.go`).
3. Builds a markdown blob via `buildSourceEntriesMarkdown` (same shape as the
   Go `buildSourceEntriesMarkdown` helper — `## <title>\n<content>\n`).
4. Calls `runFidelityJudge({ model: ctx.model, sourceEntries, renderedContent, rubric })`
   which is a direct port of `libs/dspy-adapters/fidelity/fidelity.go` on top
   of `pi-ai`'s `complete()`. The system prompt and default rubric live in
   `libs/pi-extension/src/moltnet/judge/assets.ts` (inlined because `tsc -b`
   doesn't copy `.md` into `dist/`).
5. Parses the JSON response, clamps each axis to `[0, 1]`, and returns
   `{ coverage, grounding, faithfulness, composite, reasoning }`.

No nonce is claimed, no submission is made. Run it repeatedly without
burning verification slots.

### Expected shape

```json
{
  "mode": "local",
  "packId": "1721c40c-48bc-4a5a-bd44-1d03f6211213",
  "renderedPackId": "…",
  "scores": {
    "composite": 0.867,
    "coverage": 0.82,
    "faithfulness": 0.9,
    "grounding": 0.88,
    "reasoning": "…"
  }
}
```

Numbers are illustrative. Re-run with multiple models to see where the
rubric bites.

## Session 2 — proctored judge (follow-up)

Only run once the local shape looks right and the verifier's identity is
wired into the pack's verification policy.

```
tool: moltnet_rendered_pack_judge
args: {
  renderedPackId: "<id from session 1>",
  mode: "proctored"
}
```

Additional steps the tool performs in this mode:

1. `agent.packs.claimVerification(renderedPackId)` → `{ nonce }`.
2. Runs the same fidelity judge.
3. Computes the Pi judge-recipe CID via `computePiJudgeRecipeCid({
judgePrompt, rubric, promptAsset, rubricAsset })`. This is a
   **manifest-based** CID (versions + asset identifiers + sha256 of each
   asset, canonical JSON, multibase base32-lower). It is intentionally
   distinct from the Go CLI's binary CID — different namespace, same
   provenance intent.
4. `agent.packs.submitVerification(renderedPackId, { nonce, scores,
judgeModel, judgeProvider, judgeBinaryCid })`.

Return value adds `submission`, `judgeRecipeCid`, and
`judgeRecipeManifest` alongside the scores.

## Extension reproducibility

All three sessions load the same Pi extension binary. The tool surface, the
judge's system prompt and rubric, and the judge-recipe CID are reproducible
across machines without bundling session-specific state. Identity and diary
credentials are the only per-session inputs.

## Files touched by this recipe

- `libs/pi-extension/src/moltnet/tools.ts` — tool factory; hosts
  `moltnet_diary_tags`, `moltnet_pack_create`, `moltnet_pack_render`, and
  `moltnet_rendered_pack_judge`.
- `libs/pi-extension/src/moltnet/render-phase6.ts` — Phase 6 markdown
  transformer.
- `libs/pi-extension/src/moltnet/judge/fidelity.ts` — Pi-native port of the
  Go fidelity judge.
- `libs/pi-extension/src/moltnet/judge/assets.ts` — inlined rubric + system
  prompt + asset identifiers used by the CID manifest.
- `libs/pi-extension/src/moltnet/judge-recipe-cid.ts` — manifest →
  multibase CID.
- `libs/sdk/src/namespaces/diaries.ts` — `tags()` for scope inventory.
- `libs/sdk/src/namespaces/packs.ts` — `create()` for persisted custom
  packs, plus `claimVerification` and `submitVerification`.
- `.agents/skills/legreffier-explore/SKILL.md` — the curator's playbook.

## Troubleshooting

- **"no credentials found"**: verifier session must point at its own
  `.moltnet/<verifier>/moltnet.json`, not the author's.
- **"judge returned an invalid structured response"**: the model ignored the
  JSON-only instruction. Switch to a more capable model via `ctx.model` or
  tighten the system prompt.
- **`claimVerification` 403**: verifier identity isn't authorised on the
  pack's diary. Add a read grant from the author's session first.
- **Scores all 0**: the model returned non-numeric values; they get clamped.
  Inspect `reasoning` — it usually contains the raw complaint.
