# deep-review specialist catalog

Loaded by `/deep-review` at Phase 3, which runs on **every** review that clears the size gate — there is no diff small enough to skip it. Contains: invocation template, review tiers, 8 specialist briefs. Launch each specialist in `SPECIALISTS` (from Phase 1's classification) **concurrently**, per your harness adapter's concurrency rule (sequentially if concurrent sub-reviews are unsupported).

## Invocation template

Build each specialist's prompt from this template, filling `{...}` from session state:

```
Senior code reviewer. Dimension: {DIMENSION}. Nothing else.

Diff cached at: {DIFF_FILE}
Your files (read only these from the diff, plus surrounding code as needed):
{FILES_BY_SPECIALIST[DIMENSION]}

Repo root: {REPO_ROOT}
{PR_CONTEXT_ONE_LINE — title + body first 200 chars, or "local changes, no PR"}

## Your lens
{DIMENSION_BRIEF — see catalog below}

## Ignore
- Anything outside your dimension (other specialists cover it).
- Lint territory: whitespace, import order, trailing commas, formatter output.
- Personal preference.

## Severity ladder (use labels exactly)
- Blocker: bug, security, data loss, broken contract
- Major: design flaw, missing tests on critical path, obs gap, perf regression on hot path
- Minor: readability, small refactor, non-critical test gap
- Nit: style preference, naming — explicitly optional
- FYI: context, follow-up, learning

## Output (strict, ≤400 words, markdown)

### {Dimension}
#### Blocker
- **path:LINE** — <problem, 1 sentence>. **Why:** <impact>. **Fix:** <direction, not prescription>.
#### Major
(same shape)
#### Minor
(same shape)
#### Nit
(optional, same shape)

Omit empty sections. No preamble, no file-by-file summary, no restating the diff. Findings only. If nothing to flag, output exactly: `### {Dimension}\nClean.`
```

## Review tiers

Each specialist runs at a **review tier** — `highest`, `standard`, or `fast` — chosen by where a missed
finding is expensive vs cheap. Your harness adapter (`references/harness-*.md`) binds each tier to a concrete
model and each agent-type/repo-search choice; this file never names a model.

| Tier | Specialists | Rationale |
|---|---|---|
| **highest** | Correctness, Security, DRY, Design/API/BackCompat | Missed finding = real bug / CVE / architectural mistake |
| **standard** | Performance, Operability | Mixed pattern + reasoning |
| **fast** | Tests, Readability | Pure scanning — presence checks, naming, dead code |

**Security-critical path upgrade** — if the diff touches auth, crypto, key handling, payments, PII, sessions, or tokens: Performance/Operability → `highest`; Tests/Readability → `standard`. **Never run a security-critical path at `fast`.**

## Specialist briefs + tier

Each entry gives the `{DIMENSION_BRIEF}` text and its review tier. Resolve the tier to a concrete model/agent
via your harness adapter.

1. **Correctness & Logic** — tier `highest`
   Brief: Bugs, off-by-ones, nil/undefined, broken invariants, race conditions, unhandled errors, wrong state transitions, missing edge cases (empty, boundary, unicode, very large, concurrent). Read every changed line.

2. **Security** — tier `highest`
   Brief: OWASP Top 10. Injection (SQL/cmd/XSS), authn/authz gaps, missing input validation at trust boundaries, secret leakage (logs/errors/config), unsafe deserialization, SSRF, path traversal, weak crypto, rate-limit gaps, supply-chain risk on new deps, PII handling, threat-model violations.

3. **Performance & Cost** — tier `standard` (→ `highest` on security-critical)
   Brief: N+1 queries, missing indexes, oversized payloads, hot-loop allocations, blocking I/O on hot paths, unbounded memory, missing caches, O(n²)+ where n grows, cold-start regressions, cloud-bill impact. Quantify when possible.

4. **DRY & Codebase Fit** — tier `highest`, **repo-search specialist**
   This specialist's strength is broad repo-wide search — the adapter binds it to the harness's repo-search
   tool (a dedicated search agent where one exists, otherwise a delegated reviewer that MUST run repo-wide
   `rg`/grep). It searches the **whole repo**, not just the diff.
   Brief: Does this reimplement something in the repo? Search for similar names/logic/constants. Flag extraction only when duplication is real AND the abstraction would be load-bearing. Flag pattern violations (ad-hoc code where a shared helper exists).

5. **Design / API / BackCompat** — tier `highest`
   Brief: Does this belong? over-engineered? worse abstraction than before? Backwards compatibility for callers, error-shape consistency, naming consistency with siblings, deprecation hygiene, schema/migration safety, serialization changes, external contract changes.

6. **Tests** — tier `fast` (→ `standard` on security-critical)
   Brief: Does the change have tests? Do they exercise new behavior or are they tautologies? Critical edge cases (errors, empty, boundary, concurrent)? Brittle mocks? Would they fail when prod code is broken? Missing tests on critical paths (auth, payments, data integrity) → Blocker; elsewhere → Major.

7. **Operability & Observability** — tier `standard` (→ `highest` on security-critical)
   Brief: Diagnoseable from telemetry at 3am? Logs at the right level with correlation IDs, metrics/traces for new paths, actionable error messages. Failure modes: timeouts, partial failure, retries, idempotency, blast radius on panic. Rollout: flag? rollback? migration safety under concurrent writes?

8. **Readability** — tier `fast` (→ `standard` on security-critical)
   Brief: Naming (communicative, not verbose), function size/complexity, dead code, stale/misleading comments, magic numbers → constants, layering violations. Comments explain *why* (keep) vs *what* (delete). No lint territory, no preference.

## Aggregate (after all specialists return)

1. **Dedupe** — same file:line across specialists → keep the highest-severity framing; note cross-lens agreement in the aggregated finding.
   - **Carry-over dedup** (MODE=pr): if a specialist finding duplicates a `Not addressed` thread in `PRIOR_THREADS` (Phase 1.6), drop the new finding and annotate the carry-over instead — don't report the same issue twice under two names.
2. **Re-rank globally** — Blocker → Major → Minor → Nit → FYI; within severity, by file path.
3. **Themes** — multiple findings sharing a root cause → surface as a Theme in the summary.
4. **Coverage gap check** — any changed file untouched by every specialist? Normally **none**: Correctness takes
   every changed file (Phase 1 table), so this is a safety net for files dropped during classification, not a
   routine step. Expect to skip it.

   If the uncovered set is non-empty and isn't just generated/vendored/lockfile files (those → list under
   Coverage with the reason, no spawn): **don't read them here** — this is the last step before presenting,
   exactly when this context is fullest. Launch **one** sweep sub-review at tier `standard` (resolve via your
   adapter) built from the **Invocation template above**, with `{DIMENSION}` = `Coverage sweep`, the file list =
   the uncovered files, and `{DIMENSION_BRIEF}` =

   > Every dimension at once — correctness, security, performance, design, tests, operability, readability.
   > These files fell outside every specialist's lane; this is their only pass.

   The template already carries the Ignore list, severity ladder, and output contract, so the agent needs
   nothing else. Fold its findings in via steps 1–3 like any other specialist.
