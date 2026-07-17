---
name: deep-review
description: In-depth code review with design pre-flight + parallel specialist agents (correctness, security, performance, DRY, tests, observability, design). Works on PRs, branches, paths, or local uncommitted changes. Use when asked to deeply review a PR, branch, path, or local/staged changes.
allowed-tools: Bash(git:*) Bash(gh:*) Bash(mktemp:*) Bash(cat:*) Bash(date:*) Bash(echo:*) Bash(grep:*) Bash(awk:*) Bash(sort:*) Bash(rm:*) Read Grep Glob Edit Write
metadata:
  argument-hint: "[PR# | branch | path | local | staged | unstaged] [skip-design | revalidate]"
---

World-class code review. Determine the review target (a PR number, branch, path, or the local/staged/unstaged working tree) and any flags from the invoking request. Senior reviewer, not a linter — findings must improve overall code health, not bikeshed. First question before any line-level finding: **is the approach itself sound?** (Google's Rule #1: a doomed CL shouldn't be nitpicked.)

This skill is **harness-neutral**: the phases below describe *what* to do in review tiers and capabilities, never a specific model or agent API. Before Phase 1.5 (the first place a sub-review is launched), load the one execution adapter matching the harness you are running in and use its bindings for every tier→model choice, repo-search tool, and concurrency limit:

- `references/harness-claude-code.md` — when running in Claude Code.
- `references/harness-codex.md` — when running in Codex.

If neither adapter matches your harness, fall back to: strongest available model for the `highest` tier, a mid model for `standard`, a light model for `fast`; the harness's own repo-wide search tool for DRY; and sequential execution if concurrent sub-reviews are unsupported.

This skill bundles four reference briefs plus the adapters, loaded on demand from its own directory:

- `references/preflight.md` — design pre-flight brief (Phase 1.5)
- `references/reconcile.md` — prior-review reconciliation brief (PR only; launched Phase 1.5, collected Phase 1.6)
- `references/specialists.md` — 8 specialist briefs + review tiers + aggregation (Phase 3)
- `references/submit.md` — GitHub review submission protocol (Phase 5)
- `references/harness-claude-code.md`, `references/harness-codex.md` — per-harness execution adapters (tier→model, repo-search tool, concurrency)

## State variables (maintain by name across phases)

- `MODE` — `pr` | `local` | `staged` | `unstaged` | `branch` | `path`
- `DIFF_FILE` — temp path with the cached diff (Phase 1)
- `FILES_BY_SPECIALIST` — map of specialist → list of files (Phase 1)
- `SPECIALISTS` — keys of `FILES_BY_SPECIALIST` with non-empty lists
- `VERDICT` — `PROCEED` | `PIVOT` | `ASK` (Phase 1.5)
- `PIVOT_SIZE` — `small` | `medium` | `large` (only when `VERDICT=PIVOT`)
- `PR_NUMBER`, `PR_AUTHOR`, `OWNER`, `REPO`, `PR_HEAD_OID` — filled when `MODE=pr`
- `REPO_ROOT` — dir every agent uses as repo root; defaults to `cwd`, points at a worktree when one is used (Phase 1 Step 0)
- `WORKTREE_CREATED` — `1` only when the skill itself created a worktree (drives Phase 5 cleanup)
- `STALE_CONTEXT` — set when no accurate review tree could be materialized and the review ran on the gh-API diff only (Phase 1 Step 0)
- `PRIOR_THREADS` — reconciled prior-review threads with status `Addressed` | `Not addressed` | `Ambiguous` (Phase 1.6)

## Startup context (gather first)

Before Phase 0, run these three commands and keep their output as the PR / tree / uncommitted state the phases below refer to:

- PR: `gh pr view --json number,title,headRefName,baseRefName,headRefOid,additions,deletions,changedFiles 2>/dev/null || echo "no open PR"`
- Tree: `git status --short 2>/dev/null | head -50 || echo "no repo"`
- Uncommitted: `git diff HEAD --shortstat 2>/dev/null || echo "n/a"`

---

## Phase 0 — Resolve target + flags

Parse flags from the invoking request first (any position, separate tokens):
- `skip-design` → force-skip the **pre-flight agent** only. The Phase 1.5 reconcile launch is unaffected.
- `revalidate` → force-run the **pre-flight agent** even if marker present.

Resolve the remaining token to `MODE` + diff command:

| Token | MODE | Diff |
|---|---|---|
| Numeric | `pr` | `gh pr diff <N>` |
| `local` / `wip` / `uncommitted` | `local` | `git diff HEAD` + untracked via `git ls-files --others --exclude-standard` |
| `staged` | `staged` | `git diff --cached` |
| `unstaged` | `unstaged` | `git diff` |
| Branch name | `branch` | `git diff <upstream-or-main>...<branch>` |
| Path | `path` | `git diff HEAD -- <path>` (dirty) or `git diff <base>...HEAD -- <path>` |

**Empty arg** → auto-pick: dirty tree → `local`; else open PR → `pr`; else `branch` vs main. **State the mode picked** on the first output line.

## Phase 1 — Cache diff + classify files

**Step 0 — Materialize a read-only review tree (`MODE ∈ {pr, branch}`).** The diff from `gh pr diff <N>` is
server-side and always current, but specialists + pre-flight read *surrounding code* and the DRY specialist
greps the repo **from the filesystem**. That tree must reflect the target revision — **without disturbing the
user's checkout or WIP**. Set `REPO_ROOT` (default `cwd`) to wherever the target is materialized; every agent
uses `REPO_ROOT` as its repo root.

Resolve `TARGET_REV`: `MODE=pr` → `PR_HEAD_OID` (fetch the fork's head first so the SHA exists locally:
`git fetch origin pull/<N>/head`); `MODE=branch` → the branch tip (`git fetch` the remote branch first if absent).

Then pick the review tree — **first match wins**:

1. **Current checkout already at `TARGET_REV` and clean** (`git rev-parse HEAD` == `TARGET_REV` and
   `git status --porcelain` empty) → `REPO_ROOT=cwd`. Log `Review tree: current checkout.`
2. **Reuse an existing worktree** whose HEAD is exactly `TARGET_REV` (`git worktree list --porcelain`) →
   `REPO_ROOT=<its path>`, leave `WORKTREE_CREATED` unset. Log `Review tree: reusing worktree <path>.`
   (Exact-rev match only — a worktree on the same branch at a different commit is **not** a match.)
3. **Create a dedicated detached worktree** at `TARGET_REV` into a fresh temp path:
   `git worktree add --detach "$(mktemp -d -u -t deep-review-wt.XXXXXX)" <TARGET_REV>`. Set `REPO_ROOT` to it
   and `WORKTREE_CREATED=1`. Log `Review tree: created worktree at <short-sha>.` The user's checkout — clean
   or dirty — is never touched.
4. **Fallback** — not a git repo / shallow clone / `worktree add` fails → `REPO_ROOT=cwd`, `STALE_CONTEXT=1`.
   Proceed on the gh-API diff; specialists read individual files via `git show <TARGET_REV>:<path>` where they
   can, but **repo-wide DRY/codebase-fit grep is degraded**. Log it and caveat the Phase 4 Coverage line.

Then, for every mode:

1. Save diff once: `DIFF_FILE=$(mktemp -t deep-review.XXXXXX.patch); <diff-command> > "$DIFF_FILE"`.
2. File list → `FILES`. For `MODE=pr` use `gh pr diff <N> --name-only`; for all other modes use
   `git diff --name-only <same range>` (matching the Phase 0 diff command). Never use a local range for `pr` mode.
3. **Classify by path/extension. Do NOT read diff hunks into this context** — that defeats the cache.

   | Specialist | Include file if path matches |
   |---|---|
   | Correctness | always (every changed file) |
   | DRY | always (runs unconditionally when specialist is active; uses repo-wide search) |
   | Security | auth, crypto, parse, http, network, deserialize, cookie, session, token, middleware, validator |
   | Performance | db, query, model, repo, loop, cache, worker, job, handler, pipeline |
   | Design/API | schema, migration, `*.proto`, openapi, `api/`, `public/`, `index.*`, config |
   | Tests | `*test*`, `*spec*`, `__tests__/`, or any source file whose sibling test isn't in the diff |
   | Operability | log, metric, trace, error, retry, timeout, feature-flag, migration, job |
   | Readability | any non-generated source file with >80 changed lines (use shortstat hints; no hunk read) |

3b. **Then route by content.** Paths lie: `user.ts` holding raw SQL never matches Performance's path lane, and
   a generic `utils.ts` would otherwise reach no lane at all. Scan the **cached diff** for changed lines
   (`+`/`-`) matching each lane and **union the hits into that lane's file list**. This prints *paths only* — no
   hunks enter this context, so the cache discipline above holds.

   ```bash
   lane() {  # $1 = lowercase ERE → paths whose changed lines match
     awk -v re="$1" '
       /^\+\+\+ /{ p=$2; sub(/^b\//,"",p); next }
       /^[+-]/ && !/^\+\+\+/ && !/^---/ { if (p!="" && p!="/dev/null" && tolower($0) ~ re) print p }
     ' "$DIFF_FILE" | sort -u | grep -vEi '\.(md|txt|rst|lock|sum|snap)$|(^|/)(docs|fixtures|testdata|vendor)/'
   }
   lane 'password|secret|token|api_?key|crypt|cipher|jwt|oauth|session|cookie|sanitiz|eval\(|exec\(|deserializ|innerhtml'   # → Security
   lane 'select |insert into|delete from|update .* set|\.query\(|\.aggregate\(|\.findmany\(|lru_cache|cache\.'              # → Performance
   lane 'log\.|logger|console\.|metric|trace|span\(|retry|timeout|panic|recover\('                                          # → Operability
   ```

   No match → `lane` exits non-zero with empty output; that is normal, not an error. False positives are cheap
   (the specialist reads the file and says `Clean.`); false negatives are the bug this closes — prefer
   over-inclusion. Deleted files resolve to `/dev/null` and are correctly dropped. Paths containing spaces are
   not routed by this scan — their path lane still applies.

4. Build `FILES_BY_SPECIALIST` (path lanes ∪ content lanes); set `SPECIALISTS` = keys with non-empty lists.
5. Report scope on one line: `Reviewing {MODE}: N files / +X / −Y LOC / {languages}. Specialists: {SPECIALISTS}. Skipped: {list, one-word reason each}`.

## Phase 1.5 — Design pre-flight (+ reconcile launch)

Check whether the **approach itself is sound** before spending tokens on line-level findings.

This phase spawns **two independent sub-reviews** — reconcile never reads the pre-flight's output, and each is
gated separately (`skip-design`/marker gates the pre-flight; `MODE=pr` gates reconcile). Resolve both gates
first, then **launch whatever survives concurrently** (see "Launch") — two sub-reviews when both run, one when
only one does. Never wait for the verdict before launching reconcile.

### Iteration check (skip if already validated)

Skip if any of:
- `skip-design` flag was set.
- `MODE=pr` AND a prior review by the current user contains the marker:
  ```bash
  ME=$(gh api user --jq .login)
  gh pr view "$PR_NUMBER" --json reviews \
    --jq ".reviews[] | select(.author.login == \"$ME\") | .body" \
    | grep -Fq '<!-- deep-review:v1 approach-validated -->'
  ```
- `MODE ∈ {local, branch, staged, unstaged}` AND:
  ```bash
  REF=$(git rev-parse --abbrev-ref HEAD)
  [ "$REF" = "HEAD" ] && REF=$(git rev-parse --short HEAD)
  REF_SAN=$(echo "$REF" | tr '/' '-')
  git config --local --get "deep-review.approach-validated.$REF_SAN"
  ```
  returns successfully.

**Never skip** if `revalidate` was set.

Log: `Pre-flight: running` OR `Pre-flight: skipped (<source>)`.

### Launch (both sub-reviews concurrently)

Read `references/preflight.md` for the pre-flight brief, and — when `MODE=pr` —
`references/reconcile.md` for the reconcile brief. Then launch, **concurrently** (per your adapter's concurrency
rule — start both before awaiting either; if the harness cannot run sub-reviews concurrently, run them
sequentially):

1. **Pre-flight** — one sub-review per `preflight.md`'s spec. Skip only per the iteration check above.
2. **Reconcile** (`MODE=pr` only) — one sub-review per `reconcile.md`'s spec. Its result lands in Phase 1.6.

Both run independently; neither reads the other's output. On `VERDICT ∈ {PIVOT, ASK}` the reconcile result is
simply discarded — that waste is sub-review-side and never touches this context, whereas serializing the two
would cost a full round-trip on every run.

The pre-flight returns `VERDICT: PROCEED | PIVOT | ASK` on its first line; capture it into `VERDICT` (and
`PIVOT_SIZE` when applicable).

### Handle verdict

- **Pre-flight skipped** (iteration check or `skip-design`) → no `VERDICT` is produced. Leave it unset, treat as `PROCEED`, and continue to Phase 1.6. Never re-inject the marker.
- **PROCEED** → continue to Phase 1.6. Show the user the one-paragraph summary + any minor design concerns. Inject the approach-validated marker at Phase 5 (see the Phase 5 marker table).
- **PIVOT** → skip Phases 2–3. Jump to Phase 4 with the pivot report from Phase 1.5 as the review body. No specialists, no line-level findings — they'd be noise on code about to be reworked.
- **ASK** → surface the clarifying questions and stop. If the user replies "proceed anyway" (or similar override), **treat as `PROCEED` and continue**. Otherwise wait for them to answer → re-invoke naturally (marker isn't set, so pre-flight runs again).

## Phase 1.6 — Prior-review reconciliation (`MODE=pr` only)

Before spending tokens re-deriving findings, reconcile any **existing unresolved review threads** — from any
author (humans, bots, past deep-review) — and check whether their fixes actually landed. Skip entirely for
non-PR modes, and on `VERDICT ∈ {PIVOT, ASK}` (line-level continuity is moot when the approach is changing or
unclear) — in those cases discard the reconcile agent's result without reading it.

**Collect** the result of the reconcile agent launched in Phase 1.5 (brief:
`references/reconcile.md`). It has already fetched the unresolved threads and classified each
as `Addressed` | `Not addressed` | `Ambiguous` against the review tree (`REPO_ROOT`). Store its returned thread
lines in `PRIOR_THREADS` and surface its `Prior-review: …` summary line verbatim.

If it returns exactly `Prior-review: none`, set **`PRIOR_THREADS=[]`** — that summary line is not a thread and
must never be stored as one. Downstream gates (`omit if PRIOR_THREADS empty` in Phase 4; `PRIOR_THREADS
non-empty` in Phase 5) read emptiness as a boolean, so a stray line here fires the resolve/reply offer on a PR
that has no threads at all.

**Never** run the GraphQL fetch or the per-thread code reads in this context — that is the agent's job, and its
payload is exactly what must stay out of here.

`Not addressed` threads become **carry-over**: they surface at the top of the Phase 4 report and are used to
**dedupe** specialist findings in Phase 3 aggregation (don't re-report as "new").

Phase 1.6 only **detects** — no writes here. Based on `PRIOR_THREADS`, Phase 5 then *offers* (approval-gated)
to resolve verified-`Addressed` threads and reply on `Not addressed` ones. deep-review still never **fixes the
code** behind an open thread — that stays `/fix-review`'s job.

## Phase 2 — Size gate

- **>1500 LOC or >25 files** → stop; suggest a split strategy (by layer / feature / file group). Proceed only if the user confirms.
- **Otherwise** → Phase 3. **Always fan out — there is no size below which the specialists are skipped.** A small
  diff spawns fewer specialists (only lanes with files), not none.

Never review the diff yourself as a substitute for Phase 3. The fan-out is free for *this* context — specialists
run as isolated sub-reviews — so its only cost is tokens and one round-trip, which never outweighs a missed
finding. DRY in particular cannot be done here: it is a **repo-wide** search for existing helpers using the
harness's repo-search tool (`specialists.md` + your adapter), and an inline pass silently degrades it to
diff-local pattern-matching while still reporting DRY as covered.

## Phase 3 — Parallel specialists

Read `references/specialists.md` for the invocation template, review tiers, and 8 specialist briefs, and your
harness adapter for the tier→model and repo-search bindings. Launch each specialist in `SPECIALISTS`
**concurrently** — per your adapter's concurrency rule; if the harness cannot run sub-reviews concurrently, run
them sequentially. Each specialist reads its slice of `FILES_BY_SPECIALIST` from `DIFF_FILE`. After all return,
follow the Aggregate steps at the end of that file.

## Phase 4 — Present

On `VERDICT=PIVOT`, the body is the pivot report from Phase 1.5 (no line-level findings, no severity sections). Otherwise:

```
# Code Review: <title or branch>

**Scope:** N files, +X / −Y LOC. {languages}. Sensitive: {...}.
**Verdict:** Ship | Ship with minor changes | Needs work | Reject
**Top 3 risks:** 1) ... 2) ... 3) ...
**Strengths:** <1–3 things done well>
**Themes:** <optional, cross-finding root causes>

## Carry-over (prior unresolved threads)
(MODE=pr only; omit if `PRIOR_THREADS` empty. From Phase 1.6.)
- **path:LINE** [status] — <reviewer's ask, 1 line>. <Addressed → suggest resolving / run `/fix-review`; Not addressed → still open; Ambiguous → needs a look>. <thread URL>

## Blocker
- **path:LINE** [dimension] — <problem>. **Why:** <impact>. **Fix:** <direction>.

## Major
...

## Minor / Nit / FYI
(same shape, optional sections — omit if empty)

## Coverage
Specialists run: <list — only agents that ACTUALLY ran>. Clean on: <list>.
Not run: <specialist — why (no files in its lane)>.
(If `STALE_CONTEXT=1`: add — review ran on the gh-API diff without a materialized tree; repo-wide reuse/DRY checks and sibling-file context are limited.)
```

### Severity (defined once — every finding MUST be labeled)

| Label | Meaning |
|---|---|
| **Blocker** | Bug, security, data loss, broken contract. Must fix. |
| **Major** | Design flaw, missing tests on critical path, obs gap, perf regression on hot path. Should fix. |
| **Minor** | Readability, small refactor, non-critical test gap. Optional. |
| **Nit** | Style preference, naming. Explicitly optional — author may ignore. |
| **FYI** | Context, follow-up, learning. No action expected. |

Specialists (`references/specialists.md`) and Phase 4 use this same ladder.

### Rules (apply everywhere)

- **Never claim coverage you don't have.** The Coverage section reports what *ran*, not what was *tagged*. A specialist that never spawned is `Not run`, never `Clean`. Silent degradation is worse than an admitted gap — the reader trusts this section to know what was actually checked.
- **Google's standard:** approve if the change improves overall code health, even if imperfect. Never block on preference. Reject perfectionism. Lint territory (whitespace, import order, formatter output) is invisible.
- **Framing:** describe the *problem*, not the prescribed solution. The author figures out the fix.

## Phase 5 — Offer next step

### Prior-thread actions (`MODE=pr` and `PRIOR_THREADS` non-empty)

Before the findings offer below, close the loop on reconciled threads (see `references/reconcile.md`, "Thread actions"). Both are **approval-gated** — offer, stop, wait; never write silently:

- **Verified-`Addressed`** → *"N threads look genuinely fixed but are still open. Resolve them? (yes / no / pick which)"*. On approval, resolve only the confirmed subset.
- **`Not addressed`** → *"Post a short 'still open as of this review' reply on M unfixed threads? (yes / no / pick which)"*. Reply only where it adds signal; never spam "done"/"fixed". Default to no reply if the carry-over section already says it clearly.

Never resolve `Ambiguous` threads, threads you didn't verify, or threads the user excluded.

### Findings offer

Determine **own-work** vs **someone-else's PR**:

- `MODE ∈ {local, staged, unstaged, branch}` → own-work.
- `MODE=pr` → `ME=$(gh api user --jq .login)`; if `ME == PR_AUTHOR` → own-work.

Branch by **(authorship × VERDICT × PIVOT_SIZE)**.

### Own-work

**PROCEED** → ask: *"These are your changes — want me to fix the findings directly? (yes / no / pick which / submit as review anyway)"*. **Stop and wait.**

On **yes / pick which**:
1. If "pick which", show a numbered list of findings; user chooses.
2. Build a fix plan (1 line per finding, grouped by file). Ask *"Go ahead?"* — wait.
3. On approval:
   - Apply fixes **strictly scoped** to selected findings. No drive-by refactors.
   - If a finding is ambiguous or you disagree on second look, surface it — don't guess.
   - Run lint-fix + relevant tests. Surface failures, never paper over.
   - Ask before committing: *"Commit as `fix: address self-review findings on <area>`? (yes / no / different message)"*.
   - `MODE=pr` → push after commit (ask first if non-FF). Other modes → stop at commit.
4. Final report: files changed, findings addressed, findings skipped (reason), commit SHA.

On **submit as review anyway** → fall through to someone-else flow.
On **no** → stop.

**PIVOT + `PIVOT_SIZE=small` (<100 LOC rework)** → ask: *"Want me to apply the alternative approach directly? (yes / no / submit as review anyway)"*. On yes: same plan-first discipline as the PROCEED fix flow, treating the alternative approach as the "finding."

**PIVOT + `PIVOT_SIZE=medium` (100–400 LOC)** → ask: *"The pivot is sizeable. Want me to (a) apply it now with a plan, (b) submit the design review, or (c) do nothing?"*. (a) → plan-first, expect multiple commits. (b) → someone-else flow.

**PIVOT + `PIVOT_SIZE=large` (>400 LOC or architecture-level)** → **never auto-rework**. Ask: *"This pivot is large enough that auto-refactoring would be risky. Want me to (a) submit this as a design review for the record, or (b) leave it for offline discussion?"*.

### Someone-else's PR

Ask: *"Submit this as a GitHub review with line-anchored threads? (yes / no / pick which findings)"*. **Stop and wait.** On yes, read `references/submit.md` for the submission protocol, then submit.

### Marker injection (on PROCEED only — never on PIVOT or ASK)

| Situation | Mechanism |
|---|---|
| `MODE=pr`, Branch-B submission | Marker at end of review body (see `references/submit.md`) |
| `MODE=pr`, Branch-A fix flow (no line review submitted) | Post marker-only review (see `references/submit.md`, "Marker-only review" section) |
| `MODE ∈ {local, branch, staged, unstaged}` | `REF=$(git rev-parse --abbrev-ref HEAD); [ "$REF" = "HEAD" ] && REF=$(git rev-parse --short HEAD); REF_SAN=$(echo "$REF" \| tr '/' '-'); git config --local "deep-review.approach-validated.$REF_SAN" "$(date -Iseconds)"` |

---

After Phase 5 completes, clean up: `rm -f "$DIFF_FILE"`; and if `WORKTREE_CREATED=1`,
`git worktree remove --force "$REPO_ROOT" && git worktree prune`. **Never** remove a reused/pre-existing
worktree (one where `WORKTREE_CREATED` is unset).

**Default posture: review only. Fixes/reworks happen only in own-work flows with explicit approval of both the selection/alternative and the plan.**
