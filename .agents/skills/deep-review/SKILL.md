---
name: deep-review
description: In-depth code review with design pre-flight + parallel specialist agents (correctness, security, performance, DRY, tests, observability, design). Works on PRs, branches, paths, or local uncommitted changes. Use when asked to deeply review a PR, branch, path, or local/staged changes.
argument-hint: "[PR# | branch | path | local | staged | unstaged] [skip-design | revalidate]"
allowed-tools: Bash(git *), Bash(gh *), Bash(mktemp *), Bash(cat *), Bash(date *), Bash(echo *), Bash(grep *), Bash(rm *), Read, Grep, Glob, Edit, Write
---

World-class code review. Target: $ARGUMENTS. Senior reviewer, not a linter — findings must improve overall code health, not bikeshed. First question before any line-level finding: **is the approach itself sound?** (Google's Rule #1: a doomed CL shouldn't be nitpicked.)

This skill bundles three reference briefs, loaded on demand from its own directory:

- `reference/preflight.md` — design pre-flight agent brief (Phase 1.5)
- `reference/specialists.md` — 8 specialist briefs + aggregation (Phase 3)
- `reference/submit.md` — GitHub review submission protocol (Phase 5)

## State variables (maintain by name across phases)

- `MODE` — `pr` | `local` | `staged` | `unstaged` | `branch` | `path`
- `DIFF_FILE` — temp path with the cached diff (Phase 1)
- `FILES_BY_SPECIALIST` — map of specialist → list of files (Phase 1)
- `SPECIALISTS` — keys of `FILES_BY_SPECIALIST` with non-empty lists
- `VERDICT` — `PROCEED` | `PIVOT` | `ASK` (Phase 1.5)
- `PIVOT_SIZE` — `small` | `medium` | `large` (only when `VERDICT=PIVOT`)
- `PR_NUMBER`, `PR_AUTHOR`, `OWNER`, `REPO` — filled when `MODE=pr`

## Auto-injected at expansion

- PR: !`gh pr view --json number,title,headRefName,baseRefName,additions,deletions,changedFiles 2>/dev/null || echo "no open PR"`
- Tree: !`git status --short 2>/dev/null | head -50 || echo "no repo"`
- Uncommitted: !`git diff HEAD --shortstat 2>/dev/null || echo "n/a"`

---

## Phase 0 — Resolve target + flags

Parse flags from `$ARGUMENTS` first (any position, separate tokens):
- `skip-design` → force-skip Phase 1.5.
- `revalidate` → force-run Phase 1.5 even if marker present.

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

1. Save diff once: `DIFF_FILE=$(mktemp -t deep-review.XXXXXX.patch); <diff-command> > "$DIFF_FILE"`.
2. File list: `git diff --name-only <same range>` → `FILES`.
3. **Classify each file by path/extension only. Do NOT read diff hunks here** — reading hunks defeats the cache. If a path is ambiguous (e.g. generic `utils.ts`), tag conservatively (Correctness/DRY only) and trust the other specialists' path patterns to pick it up if it's in their lane.

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

4. Build `FILES_BY_SPECIALIST`; set `SPECIALISTS` = keys with non-empty lists.
5. Report scope on one line: `Reviewing {MODE}: N files / +X / −Y LOC / {languages}. Specialists: {SPECIALISTS}. Skipped: {list, one-word reason each}`.

## Phase 1.5 — Design pre-flight

Check whether the **approach itself is sound** before spending tokens on line-level findings.

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

### Run the pre-flight

Read `reference/preflight.md` for the agent brief. Spawn **one** agent per that file's spec. The agent returns `VERDICT: PROCEED | PIVOT | ASK` on its first line; capture it into `VERDICT` (and `PIVOT_SIZE` when applicable).

### Handle verdict

- **PROCEED** → continue to Phase 2. Show the user the one-paragraph summary + any minor design concerns. Inject the approach-validated marker at Phase 6 (see Phase 6 marker table).
- **PIVOT** → skip Phases 2–3. Jump to Phase 4 with the pivot report from Phase 1.5 as the review body. No specialists, no line-level findings — they'd be noise on code about to be reworked.
- **ASK** → surface the clarifying questions and stop. If the user replies "proceed anyway" (or similar override), **treat as `PROCEED` and continue**. Otherwise wait for them to answer → re-invoke naturally (marker isn't set, so pre-flight runs again).

## Phase 2 — Size gate + mode branch

- **>1500 LOC or >25 files** → stop; suggest a split strategy (by layer / feature / file group). Proceed only if the user confirms.
- **>400 LOC or >5 files** → Phase 3 (parallel specialists).
- **≤400 LOC and ≤5 files** → **inline review**: you review the diff across all 8 dimensions yourself in one pass (using `SPECIALISTS` from Phase 1 as the tag set). Skip Phase 3. Go straight to Phase 4 with your findings.

## Phase 3 — Parallel specialists

Read `reference/specialists.md` for the invocation template and 8 specialist briefs. Spawn each specialist in `SPECIALISTS` **in parallel** when your runtime supports it. Each specialist reads its slice of `FILES_BY_SPECIALIST` from `DIFF_FILE`. After all return, follow the Aggregate steps at the end of that file.

## Phase 4 — Present

On `VERDICT=PIVOT`, the body is the pivot report from Phase 1.5 (no line-level findings, no severity sections). Otherwise:

```
# Code Review: <title or branch>

**Scope:** N files, +X / −Y LOC. {languages}. Sensitive: {...}.
**Verdict:** Ship | Ship with minor changes | Needs work | Reject
**Top 3 risks:** 1) ... 2) ... 3) ...
**Strengths:** <1–3 things done well>
**Themes:** <optional, cross-finding root causes>

## Blocker
- **path:LINE** [dimension] — <problem>. **Why:** <impact>. **Fix:** <direction>.

## Major
...

## Minor / Nit / FYI
(same shape, optional sections — omit if empty)

## Coverage
Specialists run: <list>. Clean on: <list>.
```

### Severity (defined once — every finding MUST be labeled)

| Label | Meaning |
|---|---|
| **Blocker** | Bug, security, data loss, broken contract. Must fix. |
| **Major** | Design flaw, missing tests on critical path, obs gap, perf regression on hot path. Should fix. |
| **Minor** | Readability, small refactor, non-critical test gap. Optional. |
| **Nit** | Style preference, naming. Explicitly optional — author may ignore. |
| **FYI** | Context, follow-up, learning. No action expected. |

Specialists (`reference/specialists.md`) and Phase 4 use this same ladder.

### Rules (apply everywhere)

- **Google's standard:** approve if the change improves overall code health, even if imperfect. Never block on preference. Reject perfectionism. Lint territory (whitespace, import order, formatter output) is invisible.
- **Framing:** describe the *problem*, not the prescribed solution. The author figures out the fix.

## Phase 5 — Offer next step

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

Ask: *"Submit this as a GitHub review with line-anchored threads? (yes / no / pick which findings)"*. **Stop and wait.** On yes, read `reference/submit.md` for the submission protocol, then submit.

### Marker injection (on PROCEED only — never on PIVOT or ASK)

| Situation | Mechanism |
|---|---|
| `MODE=pr`, Branch-B submission | Marker at end of review body (see `reference/submit.md`) |
| `MODE=pr`, Branch-A fix flow (no line review submitted) | Post marker-only review (see `reference/submit.md`, "Marker-only review" section) |
| `MODE ∈ {local, branch, staged, unstaged}` | `REF=$(git rev-parse --abbrev-ref HEAD); [ "$REF" = "HEAD" ] && REF=$(git rev-parse --short HEAD); REF_SAN=$(echo "$REF" \| tr '/' '-'); git config --local "deep-review.approach-validated.$REF_SAN" "$(date -Iseconds)"` |

---

After Phase 5 completes, clean up: `rm -f "$DIFF_FILE"`.

**Default posture: review only. Fixes/reworks happen only in own-work flows with explicit approval of both the selection/alternative and the plan.**
