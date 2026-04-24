# Docs Drift Audit — Consolidated Report

**Date:** 2026-04-24
**Scope:** All published docs on `docs.themolt.net` vs. current code in `main`
**Method:** Six parallel subagents, each auditing a specific surface (entries/state model, context packs, provenance/signing, MCP, architecture, scan flows). This document is the post-process combine step.

## Headline

Docs are mostly aligned for the **pre-PR-918 surface** (core entry lifecycle, signing flow, compile levers, scan flows). Significant drift sits in the **subsystems that shipped since** the docs were last touched: task queue, context-pack materialisation, entry relations graph, expanded teams API, and the DBOS-workflow re-architecture of diary CRUD.

**Severity distribution:**

- 🔴 **Structural drift** (whole subsystems missing): 3 — task queue, context-packs tables, entry_relations table + enum
- 🟡 **Stale facts** (wrong numbers, outdated claims): 6 — `derived_from` relation, "4 DBOS families" (actually 10), 42 MCP tools (actually 52), message vs CID signing confusion, MCP URL (`mcp.themolt.net` vs `api.themolt.net/mcp`), lambda default (docs 0.7 vs code 0.5)
- 🟢 **Minor gaps** (missing detail, clarifications): ~12 — CID canonical JSON, signature format, importance heuristics, nonce format, render-method flag, auth headers not surfaced in getting-started, etc.

**Zero contradictions** between audits — where two audits touched the same topic, they agreed on the ground truth.

---

## Cross-cutting themes (consolidation candidates)

Three topics surfaced across multiple audits, all pointing at the same fix. Consolidating them under one canonical home is cleaner than patching in three places.

### Theme 1: Signing as a single reference

**Audits hitting this:** #1 (entries), #3 (provenance), #4 (MCP)

All three want more detail on the signing flow but scoped differently:

- Audit #1 wants the CID canonical JSON structure documented (currently only in code comments)
- Audit #3 wants the **message-vs-CID distinction** made explicit: `crypto_prepare_signature` signs arbitrary messages (used for commits); entry immutability signs the `contentHash` CID with the entry's own `signingNonce`
- Audit #3 wants the Ed25519 signature format documented (64 bytes raw → 88 chars base64 with padding)
- Audit #3 wants the nonce format (UUID, one-time-use per request) documented
- Audit #4 wants the three MCP prompts (`identity_bootstrap`, `write_identity`, `sign_message`) catalogued

**Consolidation:** Create a new canonical section in `DIARY_ENTRY_STATE_MODEL.md` called "Signing reference" that covers all of the above in one place. Replace scattered mentions in `LEGREFFIER_FLOWS.md` and `PROVENANCE.md` with cross-links. This avoids three competing partial explanations.

### Theme 2: Auth & MCP connection

**Audits hitting this:** #4 (MCP), #5 (architecture)

Neither docs site nor getting-started explain how MCP auth actually works. Both audits independently requested:

- An MCP config JSON block with `X-Client-Id`/`X-Client-Secret` headers in the getting-started page
- A statement of the token-exchange flow (`X-Client-Id` → `Bearer` via `mcp-auth-proxy`)
- Resolution of the `mcp.themolt.net` vs `api.themolt.net/mcp` ambiguity (docs say the former, `libs/discovery` constant says the latter)

**Consolidation:** One auth subsection in `SDK_AND_INTEGRATIONS.md` (the natural home), referenced from Stage 1 of `GETTING_STARTED.md`. Ground-truth decision required: is `mcp.themolt.net` actually served, or should docs use `api.themolt.net/mcp` everywhere?

> **ACTION NEEDED from human:** confirm the canonical MCP URL before edits go in.

### Theme 3: Relations graph is documented unevenly

**Audits hitting this:** #1 (entries), #3 (provenance)

- Audit #1 treats relations (especially `supersedes`) as an entry-lifecycle mechanism
- Audit #3 treats relations as a provenance layer (entries → relations → packs → viewer)
- Audit #3 catches the real bug: **`derived_from` is listed in `PROVENANCE.md` but doesn't exist in the enum**. The actual enum is `{supersedes, elaborates, contradicts, supports, caused_by, references}`.
- Audit #5 notes the `entry_relations` table itself isn't in the ER diagram

**Consolidation:** One canonical place for the relation enum — probably a table in `DIARY_ENTRY_STATE_MODEL.md` — referenced from `PROVENANCE.md`. Fix the wrong `derived_from` first. Add the `entry_relations` table to the ER diagram.

---

## Drift catalogue (actionable edit plan)

Grouped by target file, with severity, source audit, and proposed fix.

### `docs/ARCHITECTURE.md` (🔴 heaviest drift)

| #   | Severity | Fix                                                                                                                                                                                                                                    |
| --- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | 🔴       | Add 7 missing tables to ER diagram: `context_packs`, `context_pack_entries`, `entry_relations`, `rendered_packs`, `tasks`, `task_attempts`, `task_messages`                                                                            |
| A2  | 🔴       | Rewrite §7 (DBOS Durable Workflows): list all 10 workflow families, not 4. Name `diary-workflows.ts` as the "Diary CRUD + Keto" family. Add task, registration, human-onboarding, context-distill, legreffier-onboarding, maintenance. |
| A3  | 🟡       | Update Keto namespaces section to include `ContextPack` and `Task` (each with their permit rules and tuple events)                                                                                                                     |
| A4  | 🟡       | Update the diary-CRUD sequence diagram to show Keto calls running **inside DBOS workflows** with retry config, not as fire-and-forget service-layer calls                                                                              |
| A5  | 🟡       | Update initialization-order section: 10 registerWorkflows entries + 8 afterLaunch callbacks (currently lists 6 generic steps)                                                                                                          |
| A6  | 🟢       | Add 3 new sequence diagrams: task claim/dispatch, context pack compile/render, human onboarding (after Kratos login)                                                                                                                   |
| A7  | 🟢       | Add brief MCP-service subsection: tool registration pattern, X-Client-Id/Secret auth                                                                                                                                                   |

### `docs/MCP_SERVER.md` (🟡 42→52 tools, missing prompts)

| #   | Severity | Fix                                                                                                                                                                                                    |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M1  | 🟡       | Expand teams family from `teams_list, team_members_list` to the full 9: add `teams_create, teams_delete, teams_join, teams_invite_create, teams_invite_list, teams_invite_delete, teams_member_remove` |
| M2  | 🟡       | Add `packs_diff`, `packs_update_rendered` to packs family                                                                                                                                              |
| M3  | 🟡       | Confirm canonical MCP URL (see Theme 2) — update if code is correct                                                                                                                                    |
| M4  | 🟢       | Add "Prompts" section listing `identity_bootstrap`, `write_identity`, `sign_message` with their purposes                                                                                               |
| M5  | 🟢       | Add at least one example session (doc currently only claims one exists)                                                                                                                                |

### `docs/PROVENANCE.md` (🟡 wrong enum + signing clarity)

| #   | Severity | Fix                                                                                                                                                                               |
| --- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | 🟡       | Replace `derived_from` in the "Typical relation semantics" list with correct enum members. Canonical list: `supersedes, elaborates, contradicts, supports, caused_by, references` |
| P2  | 🟢       | Cross-link to DIARY_ENTRY_STATE_MODEL.md signing reference (after Theme 1 consolidation) instead of inlining signing details                                                      |

### `docs/DIARY_ENTRY_STATE_MODEL.md` (🟢 spec gaps)

| #   | Severity | Fix                                                                                                                                                                                                                                                                                    |
| --- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | 🟢       | New "Signing reference" section covering: CID canonical JSON structure (`{c, t, tags, type, v:"moltnet:diary:v1"}`, RFC 8785, null normalisation, sorted tags), Ed25519 signature format (88-char base64), `signingNonce` format (UUID, one-time-use), message-vs-CID flow distinction |
| D2  | 🟢       | Canonical "Relations enum" table (referenced from PROVENANCE.md)                                                                                                                                                                                                                       |
| D3  | 🟢       | Clarify that per-type tags are **conventions, not enforced requirements** (code accepts any tags)                                                                                                                                                                                      |

### `docs/CONTEXT_PACK_GUIDE.md` (🟢 minor)

| #   | Severity | Fix                                                                                                                                                     |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | 🟢       | Clarify `lambda` default (recommendation 0.7 in docs, actual code default 0.5) — either change the recommendation or note the user must pass explicitly |
| C2  | 🟢       | Clarify `packs_render_preview` vs `packs_preview` (both exist, different purposes)                                                                      |

### `docs/GETTING_STARTED.md` (🟢 small additions)

| #   | Severity | Fix                                                                                                                             |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| G1  | 🟢       | Stage 1 — add MCP config JSON block with example auth headers (see Theme 2)                                                     |
| G2  | 🟢       | Stage 2 — bridge paragraph to Stage 3 (current section ends abruptly)                                                           |
| G3  | 🟢       | Stage 2 — clarify tag conventions vs. enforcement                                                                               |
| G4  | 🟢       | Stage 3 — add a CLI example showing `--include-tags` / `--exclude-tags` (both exist, neither is documented in the CLI examples) |
| G5  | 🟢       | Stage 3 — clarify server-render vs agent-render requires explicit `--render-method` flag                                        |

### `docs/LEGREFFIER_SCAN_FLOWS.md` (🟢 clarifications)

| #   | Severity | Fix                                                                                                                                                                                   |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | 🟢       | Add "Entry importance by category" table (identity=7–8, architecture=6–8, testing=5–6, security=7–8, workflow=5–6, incident=4–6, plan=5–7, domain=6–7, infrastructure=5–6, summary=5) |
| S2  | 🟢       | Clarify that consolidate produces `source:tile` entries as distinct from `source:scan`; deprecation of `source:nugget` / `source:tile` applies to legacy usage only                   |

### `docs/LEGREFFIER_FLOWS.md` (🟢 investigation addition)

| #   | Severity | Fix                                                                                                           |
| --- | -------- | ------------------------------------------------------------------------------------------------------------- |
| L1  | 🟢       | Investigation workflow — add a "coverage check" note: if no entries match, report explicit gap per entry type |
| L2  | 🟢       | After Theme 1: replace inlined signing details with a link to DIARY_ENTRY_STATE_MODEL.md                      |

---

## Ambiguous items (need human input or runtime check)

1. **MCP canonical URL** — `mcp.themolt.net` (docs) vs `api.themolt.net/mcp` (`libs/discovery`). Decide which is the contract; update the other.
2. **`lambda` recommendation** — keep docs at 0.7 and change the code default, or change docs to 0.5 to match code?
3. **Tag enforcement policy** — current code accepts any tags. Should docs double down on "conventions only" framing, or should code grow soft warnings when conventional tags are missing on signed entries?

---

## Suggested PR strategy

One PR risks becoming a monster. Split:

1. **PR A — Architecture overhaul** (🔴): ER diagram additions, DBOS workflow families section, Keto namespace additions, one new sequence diagram (pick highest-value: task or context-pack). Bulk of the work.
2. **PR B — MCP + Signing reference** (🟡): Theme 1 consolidation (new signing section in state model), Theme 2 consolidation (auth section), MCP tool list update, prompts section, `derived_from` fix.
3. **PR C — User-facing polish** (🟢): GETTING_STARTED clarifications, LEGREFFIER_FLOWS + SCAN_FLOWS touch-ups, CONTEXT_PACK_GUIDE tweaks, lambda-default decision.

PR B unblocks PR C (the state-model signing section is a cross-link target). PR A is independent of both.

---

## Files touched by this audit

Six reports (one per subagent), consolidated here. Raw reports are not saved as separate files — this document captures the complete findings. Original subagent transcripts are in the harness task-output directory but not committed.
