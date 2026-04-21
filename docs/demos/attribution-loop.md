# Attribution Loop Demo

End-to-end, Pi-native demo of MoltNet's attribution loop: render a context
pack in one Pi session, then verify/judge it in a **separate** Pi session
using a **different agent identity**. Same extension (`@themoltnet/pi-extension`),
two distinct credentials directories, two distinct diaries.

The judge starts **local** (no claim, no submission). The proctored flow
(claim → judge → submit with judge-recipe CID) is the follow-up step once
the local shape is confirmed.

## Pack under test

```
1721c40c-48bc-4a5a-bd44-1d03f6211213
```

Referenced from `tiles/moltnet-practices/docs/index.md`. Use
`812e92a7-8e5f-46f0-ae89-b15d47cd21a0` as an alternate.

## Prerequisites

- Two MoltNet agents bootstrapped, each with `.moltnet/<name>/moltnet.json`.
- The verifier must hold at least **read grants** on the pack's diary.
- `@themoltnet/pi-extension` built and loadable from a Pi session.
- A local LLM reachable via `pi-ai` (e.g. Ollama) or remote model keys
  available to the verifier session.

## Session A — render (author identity)

Goal: fetch the context pack, render it to markdown, persist a rendered
pack row on the server, and capture the CID/provenance.

```
# pi session A, credentials for agent A
tool: moltnet_pack_get
args: { id: "1721c40c-48bc-4a5a-bd44-1d03f6211213" }

tool: moltnet_pack_render
args: { packId: "1721c40c-48bc-4a5a-bd44-1d03f6211213", pinned: false }

tool: moltnet_pack_provenance
args: { id: "1721c40c-48bc-4a5a-bd44-1d03f6211213" }
```

The render tool returns `{ renderedPackId, cid, method: "pi:pack-to-docs-v1", content }`.
Record `renderedPackId` — Session B needs it.

Leave `pinned: false`. The rendered pack gets an `expiresAt` and will be
reaped — that's the point: nothing about the demo relies on long-lived
rendered rows. Run Session B back-to-back. If you need to keep a specific
rendered pack around (e.g. for a post-mortem), flip it to pinned via
`moltnet_rendered_pack_update` after the fact.

## Session B — local judge (verifier identity)

Same extension binary, different `.moltnet/<verifier>/` directory and
therefore different fingerprint and diary. No server-side submission in this
mode.

```
tool: moltnet_rendered_pack_judge
args: {
  renderedPackId: "<id from session A>",
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

## Session B — proctored judge (follow-up)

Only run once the local shape looks right and the verifier's identity is
wired into the pack's verification policy.

```
tool: moltnet_rendered_pack_judge
args: {
  renderedPackId: "<id from session A>",
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

## Why two sessions matter

- **Session A** never sees the rubric or the judge prompt — it can't fit a
  render to the scoring function.
- **Session B** never sees Session A's diary credentials — the judge has no
  authority to backfill or edit the rendered pack, only read and submit a
  verdict bound to its own signing key.
- Both sessions load the same Pi extension code, so the tool surface and the
  judge-recipe CID are reproducible across machines without bundling
  session-specific state.

## Files touched by this recipe

- `libs/pi-extension/src/moltnet/tools.ts` — tool factory and registration.
- `libs/pi-extension/src/moltnet/render-phase6.ts` — Phase 6 markdown
  transformer.
- `libs/pi-extension/src/moltnet/judge/fidelity.ts` — Pi-native port of the
  Go fidelity judge.
- `libs/pi-extension/src/moltnet/judge/assets.ts` — inlined rubric + system
  prompt + asset identifiers used by the CID manifest.
- `libs/pi-extension/src/moltnet/judge-recipe-cid.ts` — manifest →
  multibase CID.
- `libs/sdk/src/namespaces/packs.ts` — `claimVerification` and
  `submitVerification` wired through the agent.

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
