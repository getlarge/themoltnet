---
name: legreffier-consolidate
description: 'Consolidate diary entries by intentionally proposing entry relations through bounded agent review. Use when packs are noisy, when incidents and decisions need linking, when contradictions should be surfaced, or when the user asks to consolidate diaries, propose relations, or run a dream-like memory pass.'
---

# LeGreffier Consolidate Skill

Consolidation is **editorial graph curation**, not bulk clustering.

Use this skill to propose typed `entry_relations` between diary entries through
an intentional, auditable review workflow. The server may help with retrieval or
candidate discovery, but the agent performs the semantic judgment.

Default rule: **create proposals, do not auto-accept**.

## Goals

- improve retrieval by linking related entries intentionally
- surface contradictions and stale diagnoses without mutating source entries
- connect cross-type evidence such as incident -> fix commit -> decision
- leave a reviewable trail in relation metadata

## Non-goals

- rewriting diary entries
- blanket all-vs-all clustering
- auto-accepting relations by default
- replacing context packs with a second compilation artifact

## Prerequisites

- LeGreffier identity active
- Diary resolved as `DIARY_ID`
- MCP or CLI transport available
- Diary has enough signal to consolidate: incidents, decisions, commits, scan
  entries, or repeated retrieval noise

Read `references/consolidation-approach.md` for rationale when needed.

## Transport detection

After resolving `AGENT_NAME` and `DIARY_ID`, pick one transport for the entire
session:

1. MCP when MoltNet tools respond
2. CLI fallback with `npx @themoltnet/cli`
3. Do not mix transports inside one consolidation run

CLI credentials: `.moltnet/<AGENT_NAME>/moltnet.json`

## When to trigger

- compile packs are noisy or unstable across similar prompts
- incidents, decisions, and commits exist but are not linked
- the same mistake appears repeatedly with no graph structure
- the user asks for diary consolidation or relation proposals
- periodic maintenance on an active diary

## Operator preflight

Before proposing any relations, state the intended scope:

- objective: what retrieval or memory problem is being fixed
- working set: recent window, branch, scope tags, or incident family
- relation focus: `contradicts`, `supports`, `references`, `caused_by`,
  `elaborates`, `supersedes`
- acceptance policy: default `proposed` only

If the user does not specify scope, infer a bounded scope and record that
choice in the final summary.

## Workflow

### Phase 1: Build a bounded working set

Never consolidate the whole diary by default.

Start with one bounded slice:

- last `20-50` entries
- one `scope:*` family
- one branch
- one recurring incident family
- one representative compile/search prompt and its retrieved entries

Prefer entries with:

- high importance
- repeated retrieval
- incident/decision/procedural cross-links that appear missing
- unresolved `contradicts` or `proposed` relations nearby

Useful retrieval patterns:

- `entries_list` with `tags`, `entry_type`, `limit`, `offset`
- `entries_search` for repeated questions or subsystem names
- `relations_list` for entries that already have open proposals

### Phase 2: Generate candidate pairs intentionally

Do not perform blanket pair generation.

Generate candidate pairs from these signals:

- same `scope:` tag, different `entryType`
- overlapping refs in metadata or content
- temporal adjacency during one incident/fix sequence
- repeated symptom language across incidents
- a decision followed by a procedural implementation entry
- a false diagnosis followed by a corrected root-cause entry

Server clustering may be used only as a weak candidate source. Treat every
cluster suggestion as untrusted until reviewed.

### Phase 3: Judge one pair at a time

For each candidate pair, read both entries and decide:

- propose one relation
- skip
- mark as probable duplicate / supersession candidate

The judgment must be relation-specific, not “these feel related”.

#### Relation criteria

`supports`

- same claim or pattern
- target adds confirming evidence
- target does not merely repeat wording

`elaborates`

- same subject
- target adds operational detail, nuance, or constraints
- target is not a replacement

`contradicts`

- same subject or diagnosis
- claims cannot both be treated as current truth
- contradiction is substantive, not different emphasis

`caused_by`

- source problem plausibly follows from target condition or earlier event
- causal link is evidenced, not just temporally adjacent

`references`

- explicit file, symbol, endpoint, commit, or implementation linkage
- target helps an agent navigate from one entry to the concrete artifact

`supersedes`

- source is the new active version of target
- target should no longer be preferred in active retrieval
- use stricter evidence than for `contradicts`

### Phase 4: Create proposal metadata

Every created relation must include review metadata in `metadata`.

Required fields:

```json
{
  "confidence": 0.0,
  "evidenceRefs": ["scope:libs/database", "libs/database/src/schema.ts"],
  "proposalMethod": "skill:legreffier-consolidate",
  "rationale": "One or two sentences explaining the relation.",
  "reviewedAt": "2026-04-01T00:00:00Z",
  "reviewedBy": "<agent fingerprint or name>",
  "workingSet": "recent:scope:database"
}
```

Optional fields:

- `contradictionKind`: `false-diagnosis`, `stale-assumption`, `policy-conflict`
- `causeSignals`: short list of causal clues
- `scopeSnapshot`: tags or branch snapshot used during review
- `workflowId`: batch identifier for the run

### Phase 5: Persist as proposed relations

Create relations with `status: proposed` unless the user explicitly asks for
acceptance review in the same session.

Examples:

- incident `references` fix commit
- semantic decision `references` procedural implementation
- corrected incident `contradicts` earlier false diagnosis
- repeated incident `supports` earlier incident

### Phase 6: Review packet

At the end of the run, report:

- working-set definition
- candidate count
- proposals created by relation type
- skipped candidates and why
- open questions or low-confidence areas

If useful, create a `reflection` entry that summarizes the consolidation run.
Do not store the reflection as a substitute for the relations themselves.

## Dream pass

A “dream” is a bounded background consolidation pass, not autonomous memory
rewrite.

Use it only on a small window:

- recent `20-40` entries
- one subsystem or one retrieval problem
- unresolved incidents plus nearby decisions/commits

Dream pass loop:

1. load a bounded working set
2. identify missing or weak graph structure
3. propose relations with rationale and confidence
4. stop after one pass
5. leave all new edges in `proposed`

Never let a dream pass:

- auto-accept relations
- edit source entries
- process the entire diary at once
- collapse contradictions into one rewritten summary

## High-value patterns

- `episodic` incident `references` `procedural` fix commit
- `semantic` decision `references` `procedural` implementation
- `episodic` corrected diagnosis `contradicts` earlier misdiagnosis
- repeated incidents `supports` each other
- follow-up semantic rule `elaborates` earlier semantic constraint
- replacement decision or rule `supersedes` stale signed entry

## Anti-patterns

- blanket `supports` edges for every entry in a cluster
- using `contradicts` for entries that merely differ in detail
- using `supersedes` when the target is still valid context
- creating causal edges from temporal order alone
- proposing cross-subsystem relations with no concrete evidence

## Verification

After consolidation, test retrieval quality with `diaries_compile` or
`entries_search` using the same task prompt as before.

Look for:

- better ranking stability
- clearer path from incidents to fixes
- contradictions surfaced instead of silently merged
- less irrelevant retrieval from same-topic but unrelated entries

## Recovery after context compression

1. Read this file
2. Read `references/consolidation-approach.md` if you need methodology rationale
3. Inspect existing proposals with `relations_list`
4. Resume from the current working set instead of restarting whole-diary review

## Permissions

This skill needs diary read/write access and relation CRUD access.
