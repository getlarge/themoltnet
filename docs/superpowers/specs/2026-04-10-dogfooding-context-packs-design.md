# Design: Dogfooding Context Packs — Explore → Render → Judge → Eval

**Date:** 2026-04-10
**Status:** draft
**Related:** [journal](../../articles/2026-04-09-dogfooding-context-packs.md), [issue #523](https://github.com/getlarge/themoltnet/issues/523) (deferred), [first article](https://getlarge.eu/blog/before-you-can-evaluate-agent-context-you-need-to-generate-it)

---

## Goal

Manually walk the full context-pack workflow end-to-end — from diary exploration to scored eval results — producing one rendered pack with per-section attribution and 4-6 in vitro eval scenarios. Document every friction point. Produce a follow-up article to the first blog post.

## Non-goals

- Proctored eval protocol (#523) — learn first, design trust later.
- Verify/attestation flow (`moltnet rendered-packs verify`).
- Multiple rendered packs in one session.
- Judge rubric extension for attribution integrity (follow-up issue).
- In vivo scenarios (feature not landed yet; note candidates for later).

## Article framing

Follow-up to [Before You Can Evaluate Agent Context, You Need to Generate It](https://getlarge.eu/blog/before-you-can-evaluate-agent-context-you-need-to-generate-it). That article covered the Generate phase (compost). This article covers **Evaluate** — the worms turning compost into usable soil.

**Do not repeat from the first article:**

- What LeGreffier is or why it exists
- The context lifecycle framework (Debois model)
- Why structured memory > static files
- The Moonwell exploit case study
- Entry types (episodic, semantic, procedural, reflection)

**What evolved since (call out explicitly):**

- Rendered packs as a first-class concept, separate from source packs
- In vitro vs in vivo eval distinction
- The fidelity judge (coverage, grounding, faithfulness)
- Attribution convention in rendered packs
- The "scenarios before pack" methodology — learned this session
- The baseline-filter step — learned this session

**Open questions from the first article that we now have answers for:**

- "What unit of evaluation?" → rendered packs, scored by weighted checklists
- "When should distillation happen?" → on-demand: custom pack assembly, human+LLM rendering
- "How to compress without confabulation?" → fidelity judge as the guard

## Deliverables

| #   | Artifact                                     | Path / location                                        |
| --- | -------------------------------------------- | ------------------------------------------------------ |
| 1   | Journal article                              | `docs/articles/2026-04-09-dogfooding-context-packs.md` |
| 2   | 1 rendered pack with per-section attribution | Persisted via `moltnet pack render` API                |
| 3   | 4-6 in vitro eval scenarios                  | `evals/moltnet-practices/<name>/`                      |
| 4   | Baseline + with-pack eval results            | Recorded in journal                                    |
| 5   | Fidelity judge results (2+ providers)        | Recorded in journal                                    |
| 6   | Friction log                                 | Section in journal                                     |
| 7   | GETTING_STARTED.md diffs                     | Unstaged edits, end of session                         |
| 8   | Attribution convention                       | New section in `docs/CONTEXT_PACK_GUIDE.md`            |
| 9   | Re-rendered existing packs with attribution  | Persisted via API                                      |

## Workflow (10 steps)

### Step 1: Net cast — diary exploration

Use `legreffier-explore` skill or CLI to scan diary entries from the last 3-4 weeks. Let the output decide the target — go fishing, cast the net.

**Tooling:** Prefer CLI + subagents for chaining:

```bash
moltnet diary list
moltnet entries list --diary-id <id> --limit 50 --sort created_at:desc
moltnet diary tags --diary-id <id>
```

**Output:** 2-3 candidate clusters with entry counts and tag signatures. Pick one.

### Step 2: Scenario stubs from raw incidents

**Before any pack work.** Scenarios come from the incident record, not from a pack draft. This is the most important methodological rule.

Each scenario follows the established format:

```
evals/moltnet-practices/<scenario-name>/
├── task.md          # Problem + enough code context to be self-contained
├── criteria.json    # Weighted checklist, weights sum to 100
└── eval.json        # {"mode": "vitro"}
```

**Lessons from existing scenarios:**

- **task.md** gives enough code context that the agent _could_ reasonably solve it — the test is whether it avoids the trap, not whether it's helpless. Include example code, schema snippets, config fragments.
- **criteria.json** puts the heaviest weight (30-50) on the criterion most likely missed without context. Notes/explanation criteria cap at 10-20.
- **eval.json** is `{"mode": "vitro"}` for all scenarios this session. Note in vivo candidates in the journal.

**Target:** 4-6 scenario stubs.

### Step 3: Baseline filter

Run baseline-only eval on each scenario:

```bash
moltnet eval run --scenario evals/moltnet-practices/<name>
```

**Decision rules:**

- **>= 90%:** drop the scenario.
- **80-89%:** harden it (subtler trap, raise weight on missed criterion).
- **< 80%:** keep as-is. Gap-test confirmed.

Record scores in journal. ~15 min filter.

### Step 4: Assemble custom source pack

We curate the pack ourselves — no MMR algorithm, no `diary compile`. The explore output from step 1 gives us entry IDs; we pick the ones that matter and assemble a custom pack:

```bash
moltnet pack create <diary-id> \
  --type custom \
  --entries <entry-id-1>,<entry-id-2>,... \
  --token-budget 6000
```

Or via MCP:

```
packs_create({
  diary_id: "<diary-id>",
  packType: "custom",
  params: { recipe: "agent-selected", reason: "<cluster topic>" },
  entries: [
    { entryId: "<id>", rank: 1 },
    { entryId: "<id>", rank: 2 }
  ],
  tokenBudget: 6000
})
```

This is the rod — hand-picking entries from the net's haul. The compile endpoint runs MMR scoring under the hood, which is useful for automated workflows, but for dogfooding we want to see exactly what goes in and control the ranking ourselves.

Token budget 6000 is a starting point. Adjust after inspecting the pack.

**Output:** Source pack ID.

### Step 5: Draft rendered pack (human + LLM)

1. Preview: `moltnet pack render --preview --out /tmp/rendered-preview.md <pack-id>`
2. Human reviews, identifies section structure.
3. LLM drafts rendered Markdown with per-section attribution.
4. Human edits for clarity, accuracy, adds context the LLM missed.

**Attribution convention (per-section):**

Each section ends with an italic `Sources:` line:

```markdown
### Hard Rules

1. **Use `getExecutor(db)` for all writes.** ...
2. **Exclude the embedding column from reads.** ...

_Sources: [`e:abc12345`](@getlarge · agent:7f3a), [`e:def67890`](@getlarge · agent:7f3a)_
```

Format: ``[`e:<8-char-id-prefix>`](<@handle> · agent:<4-char-agent-prefix>)``

- `e:` prefix distinguishes entry refs from other links.
- 8-char entry ID prefix (no hyphens) — unique within a pack.
- 4-char agent ID prefix — recognizable; full ID in provenance graph.
- Same-author entries share one handle.

### Step 6: Inner loop — fidelity judge

```bash
# Persist as rendered pack
moltnet pack render \
  --render-method agent:pack-to-docs-v1 \
  --markdown-file /tmp/rendered-draft.md \
  <pack-id>

# Judge with 2+ providers
moltnet rendered-packs judge --id <rendered-pack-id> --provider claude-code
moltnet rendered-packs judge --id <rendered-pack-id> --provider codex --model gpt-5.3-codex
```

Three axes (0.0-1.0): coverage, grounding, faithfulness. Iterate until both providers score >= 0.8 on all three.

Record scores per iteration in journal.

### Step 7: Outer loop — efficiency eval

```bash
moltnet eval run \
  --scenario evals/moltnet-practices/<name> \
  --pack /tmp/rendered-draft.md
```

Pack should move scores by >= 15pp on at least 3 surviving scenarios. If not, iterate on pack content.

Record baseline vs with-pack scores side by side in journal.

### Step 8: Re-render existing packs with attribution

Create new rendered pack instances from the source packs behind `database-patterns.md` and `incident-patterns.md`:

1. Find source pack IDs: `moltnet pack list --diary-id <diary-id>`
2. Preview each: `moltnet pack render --preview --out /tmp/<name>-preview.md <pack-id>`
3. Add `Sources:` lines to each section.
4. Persist: `moltnet pack render --render-method agent:pack-to-docs-v1 --markdown-file ...`

### Step 9: Friction log → docs

For each friction:

- CLI UX issue → file an issue.
- Workflow ordering question → fold into `docs/GETTING_STARTED.md`.
- Conceptual gap → fold into `docs/CONTEXT_PACK_GUIDE.md`.
- Article material → keep in journal.

### Step 10: Stop

Do not proceed to verify/attestation. Do not start #523.

## Attribution convention (full reference)

### In rendered packs

```
*Sources: [`e:<8-char-prefix>`](<@handle> · agent:<4-char-prefix>)[, ...]*
```

- End of each section, before the next heading.
- Italic formatting.
- Same-author entries listed together with one handle.

### Provenance graph

No change. `Sources:` references entry IDs already in `pack → includes → entry` edges.

### Back-compatibility

Existing files without `Sources:` lines are valid. Attribution is additive.

## In vitro vs in vivo

All scenarios this session: `{"mode": "vitro"}`.

In vivo upgrade path (when mode lands):

1. Add `fixtures/` directory.
2. Change eval.json to `{"mode": "vivo", "ref": "<git-ref>"}`.
3. Update task.md: "produce the actual files" instead of "describe the procedure."

## Follow-up issues (not in scope)

| Topic                                           | Why deferred                   |
| ----------------------------------------------- | ------------------------------ |
| Attribution integrity rubric dimension          | Separate from #523. Own issue. |
| In vivo scenario upgrades                       | Blocked on in vivo mode.       |
| Automated attribution in `packs_render_preview` | Not blocking manual workflow.  |
| GEPA optimization of new pack                   | Manual tuning first.           |
