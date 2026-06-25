# deep-review specialist catalog

Loaded by `/deep-review` at Phase 3 (parallel mode). Contains: invocation template, 8 specialist briefs, and aggregation rules. Spawn each specialist in `SPECIALISTS` (from Phase 1's classification) **in parallel** when your runtime supports it.

## Invocation template

Build each specialist's prompt from this template, filling `{...}` from session state:

```
Senior code reviewer. Dimension: {DIMENSION}. Nothing else.

Diff cached at: {DIFF_FILE}
Your files (read only these from the diff, plus surrounding code as needed):
{FILES_BY_SPECIALIST[DIMENSION]}

Repo root: {cwd}
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

## Specialist briefs

Each entry below gives the `{DIMENSION_BRIEF}` text. Use a reviewer capable of the dimension's risk: correctness, security, design, and DRY need deep reasoning; tests and readability can be lighter unless the diff touches a critical path. If your runtime does not support subagents or parallelism, run the same briefs sequentially yourself.

1. **Correctness & Logic**
   Brief: Bugs, off-by-ones, nil/undefined, broken invariants, race conditions, unhandled errors, wrong state transitions, missing edge cases (empty, boundary, unicode, very large, concurrent). Read every changed line.

2. **Security**
   Brief: OWASP Top 10. Injection (SQL/cmd/XSS), authn/authz gaps, missing input validation at trust boundaries, secret leakage (logs/errors/config), unsafe deserialization, SSRF, path traversal, weak crypto, rate-limit gaps, supply-chain risk on new deps, PII handling, threat-model violations.

3. **Performance & Cost**
   Brief: N+1 queries, missing indexes, oversized payloads, hot-loop allocations, blocking I/O on hot paths, unbounded memory, missing caches, O(n²)+ where n grows, cold-start regressions, cloud-bill impact. Quantify when possible.

4. **DRY & Codebase Fit**
   Brief: Does this reimplement something in the repo? Grep for similar names/logic/constants. Flag extraction only when duplication is real AND the abstraction would be load-bearing. Flag pattern violations (ad-hoc code where a shared helper exists).

5. **Design / API / BackCompat**
   Brief: Does this belong? over-engineered? worse abstraction than before? Backwards compatibility for callers, error-shape consistency, naming consistency with siblings, deprecation hygiene, schema/migration safety, serialization changes, external contract changes.

6. **Tests**
   Brief: Does the change have tests? Do they exercise new behavior or are they tautologies? Critical edge cases (errors, empty, boundary, concurrent)? Brittle mocks? Would they fail when prod code is broken? Missing tests on critical paths (auth, payments, data integrity) → Blocker; elsewhere → Major.

7. **Operability & Observability**
   Brief: Diagnoseable from telemetry at 3am? Logs at the right level with correlation IDs, metrics/traces for new paths, actionable error messages. Failure modes: timeouts, partial failure, retries, idempotency, blast radius on panic. Rollout: flag? rollback? migration safety under concurrent writes?

8. **Readability**
   Brief: Naming (communicative, not verbose), function size/complexity, dead code, stale/misleading comments, magic numbers → constants, layering violations. Comments explain *why* (keep) vs *what* (delete). No lint territory, no preference.

## Aggregate (after all specialists return)

1. **Dedupe** — same file:line across specialists → keep the highest-severity framing; note cross-lens agreement in the aggregated finding.
2. **Re-rank globally** — Blocker → Major → Minor → Nit → FYI; within severity, by file path.
3. **Themes** — multiple findings sharing a root cause → surface as a Theme in the summary.
4. **Coverage gap check** — any changed file untouched by any specialist? Read it yourself briefly, or mark uncovered in the Coverage section.
