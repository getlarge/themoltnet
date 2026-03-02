---
date: '2026-03-02T07:15:00Z'
author: claude-opus-4-6
session: legreffier-scan-skill-001
type: decision
importance: 0.8
tags: [decision, legreffier, context-flywheel, scan, ws16, skill]
supersedes: null
signature: <pending>
---

# Decision: LeGreffier Scan Skill — Codebase Evidence Generation

## Context

The context flywheel needs a Generate stage before anything else can happen.
Agents working on customer repos need a way to systematically scan a codebase
and create structured diary entries that later consolidation can use to build
reusable context tiles. This is the first concrete deliverable of the 12-week
LeGreffier validation cycle.

The skill was designed through iterative review: initial draft, code review
(4 findings), external agent review, and several rounds of design discussion
on context window pressure, scan recovery, and staleness management.

## Substance

### The skill: `.claude/skills/legreffier-scan/SKILL.md`

A reusable skill that scans a codebase and creates structured diary entries.
Key design decisions:

**Scan modes.** Bootstrap (default, 8-20 entries, safe sources only) vs deep
(20-40 entries, all categories). Bootstrap is fast and safe for first contact
with any repo. Deep requires explicit request.

**Mandatory dry-run plan.** Before reading any source files, the scan produces
a structured plan (files to scan, categories to emit, estimated entry count,
skipped files) and waits for user approval. This is both a safety gate and the
recovery checkpoint.

**Scan session IDs.** Every scan run gets a unique ISO-8601 timestamp as its
session ID. All entries are tagged `scan-session:<id>`. This solves two
problems: (1) recovery after context compression filters to the current
session only, (2) re-scan identifies the previous session's entries cleanly.

**Summary supersession chain.** The scan summary entry is the single source of
truth for "which scan session is current." Consumers find the most recent
non-superseded summary, extract the session ID, and trust only entries from
that session. Individual entry supersession is best-effort; summary
supersession is the critical invariant.

**Confidence levels.** Every entry is tagged high/medium/low based on source
quality (documented vs inferred). Low-confidence entries are flagged in the
scan summary for human review.

**Structured gap reporting.** The scan summary includes explicit gaps
(categories missing, partial categories, stale sources, low-confidence
entries). This is the first Observe artifact — it tells the next agent what
the scan couldn't cover.

**Context window strategy.** Batched execution by category group, with
subagent delegation for repos with 15+ expected entries. Each subagent gets a
fresh context window. The primary agent holds only the plan and collected
results. Recovery after context compression uses session-tagged diary queries.

**Local download for re-scan.** Instead of N API calls to compare entries
one-by-one, download all previous scan entries in 2 API calls, build a local
index (source path → entry ID + digest), diff locally, then push only changed
entries. Reduces a 60-call re-scan to ~12 calls.

**Secret denylist.** Hard gate preventing scan of `.env*`, credentials, keys,
tokens, SSH keys, `moltnet.json`, CI secrets. For infrastructure entries,
extract structure and conventions only — never secret values.

### Code review findings (all fixed)

1. **High — Secret ingestion risk.** Infrastructure scan targets included env
   files. Fixed: added comprehensive secret denylist section.
2. **Medium — Git hash for staleness.** Changed from git short hash to
   SHA-256 content digest (first 16 hex chars). Stable across rebases, works
   for untracked files.
3. **Medium — Summary tag pollution.** Scan summary used
   `scan-category:identity` which would pollute identity queries. Fixed:
   added `summary` category.
4. **Low — Source-path tag truncation.** Removed `source-path` from tags,
   kept source path only in metadata content where there's no length limit.

### Design decisions deferred

- **Dedicated scan diary:** Decided against for v1. Tag-based separation
  (`source:scan`) works. Split to dedicated diary if organic entry queries
  get polluted.
- **TTL on entries:** Not needed. Summary supersession chain +
  `exclude_superseded: true` makes old entries invisible without deletion.
- **Canonical hashing alignment with #261:** Noted for future — scan digests
  could use `SHA-256("moltnet:scan:v1\n" + content)` pattern from the
  content-signing spec.

## Continuity Notes

### What's next

1. **Test the scan skill on MoltNet itself** — first real run to validate
   entry quality, count, and context window behavior
2. **Draft the consolidation skill** — takes scan entries and produces tiles
   (the Distill stage of the flywheel)
3. **Build the compare workflow** — run tasks with and without tiles, measure
   improvement (the Evaluate stage)

### Open questions

- How well does the subagent delegation work with Codex multi-agent? Need to
  test the prompt template with Codex's agent spawning.
- The `entries_list` API always returns full content. For large working sets,
  a `fields` parameter would reduce download size for the local diff pattern.
- Confidence calibration: what does "medium" really mean in practice? Need
  data from real scans to tighten the definitions.
