---
name: security-review
description: MANDATORY procedure for any pr_review task whose rubric is `pr-security-v1` or whose prompt asks for a security review. Read this skill FIRST before reading the PR diff. Defines the sequential recon → hunt → self-validate → trace → dedup → report pipeline a single agent must run against a PR. Without it, the review will be incomplete and the structured output will be rejected.
---

# Security Review

You are reviewing a GitHub pull request **for security risk introduced by the diff** — not for correctness, complexity, or style. Other workflows already cover those.

You are one agent, not a fleet. You will compensate for the absence of fan-out by running each pipeline phase explicitly and recording what you found before moving on.

## Scope discipline

- Score risk **introduced by the diff**, not pre-existing risk in untouched code.
- Complement Semgrep — focus on logic, data flow, and context the static analyzer cannot see. If a finding overlaps a Semgrep rule, cite the rule and move on.
- Do not duplicate complexity/test-coverage feedback already produced by `pr_review` complexity runs.
- Advisory only. Do not block the PR. Do not push commits. Do not run tests.

## Available tools

- `gh pr view <n> --repo <slug>` — PR title, body, commits, head ref.
- `gh pr diff <n> --repo <slug>` — full unified diff.
- `gh pr diff <n> --repo <slug> --name-only` — changed file list.
- `Read` — read any file in the workspace; use to inspect callers and surrounding code.
- `Grep` / `Bash` — search the workspace for caller patterns, schema definitions, validators.

Do **not** invoke write tools (`Edit`, `Write`, `git commit`, `gh pr edit`, etc.) except the one explicit `gh pr comment` call in the Report phase.

## MoltNet-specific risk surfaces

When evaluating the diff, give extra attention to these MoltNet-specific patterns:

- **Ory JWT validation** — issuer/audience checks, `kid` lookups, expiry. Look for new routes that skip the auth plugin or use `optionalAuth` where required-auth was needed.
- **Keto permission checks** — every multi-tenant resource needs an explicit `check` call before mutation. Removed/weakened checks are critical findings.
- **Team-scoped diary access** — `MOLTNET_TEAM_ID` and diary ownership must scope every diary/entry query. Cross-tenant leakage is critical.
- **Ed25519 signature handling** — private keys must never leave their boundary; signatures must be verified before trust; payloads must be canonicalized; nonces/timestamps must prevent replay.
- **TypeBox boundary validation** — every HTTP/MCP/webhook handler input needs a TypeBox schema with `additionalProperties: false`. Bypassing validation, threading `unknown` inward, or moving validation past the boundary is a finding.
- **dotenvx secrets** — sensitive env vars must stay encrypted in `.env`. Adding a plain entry to `env.public` for a secret is a finding.
- **Pino + OTel redaction** — tokens, keys, PII must be redacted in log statements and span attributes.

## Pipeline

You MUST execute every phase below, in order, and write the phase output to a scratch buffer (your own working memory) before moving on. Do not skip phases even on small diffs — the structure is what compensates for being a single agent.

### Phase 1 — Recon

1. Fetch PR metadata: `gh pr view <n> --repo <slug>`.
2. Fetch the diff: `gh pr diff <n> --repo <slug>`.
3. List changed files: `gh pr diff <n> --repo <slug> --name-only`.
4. For each changed file, identify:
   - Layer (route handler, plugin, schema, migration, library, test, config, infra).
   - Trust boundary status (is it on the system edge? interior?).
   - Whether it touches any MoltNet-specific risk surface listed above.
5. Build a short mental architecture note: "this PR touches `<surfaces>`, the data flow into the changed code is `<source → sink>`, the existing auth/validation guards on the affected paths are `<list>`."

Recon output: a list of `(file, layer, risk_surfaces, data_flow_summary)` tuples.

### Phase 2 — Hunt

For each rubric criterion (`injection_safety`, `authn_authz_integrity`, `crypto_handling`, `secret_hygiene`, `input_validation`, `dependency_risk`, `safe_failure_modes`), walk the diff with that lens. For every candidate finding record:

- **File:line** — exact location.
- **Criterion** — which rubric criterion it would fail.
- **Severity** — provisional (critical / high / medium / low / info).
- **Hypothesis** — one sentence: "this change appears to <do X>, which would <consequence>."

Be aggressive in Phase 2. False positives are filtered in Phase 3. False negatives are not.

Hunt output: a flat list of candidate findings.

### Phase 3 — Self-validate

For every candidate finding from Phase 2, try to **disprove it** before accepting it. Read the surrounding code, callers, and any validation/auth plugins the path passes through. Specifically check:

- Is the input actually attacker-controlled? Trace it back to a system boundary.
- Is there a TypeBox schema, auth gate, or Keto check upstream that already neutralizes it?
- Is the sink actually reachable from the boundary in the changed code path, or is it dead code / behind a feature flag / behind a stricter check?
- Is this a pattern the codebase uses safely elsewhere? Grep for similar usage.

For each candidate, record one of:

- **CONFIRMED** — disproof attempt failed. Keep the finding.
- **REFUTED** — disproof succeeded. Drop the finding. Note the disproof in your scratch buffer (do NOT include refuted findings in the final report).
- **UNCERTAIN** — disproof inconclusive. Keep the finding, downgrade severity by one level, mark as `info` if it was `low`, and note the uncertainty in the rationale.

Self-validate output: filtered findings list.

### Phase 4 — Trace (reachability)

For every CONFIRMED or UNCERTAIN finding, walk the data flow from the system boundary to the sink and record it as a chain:

```
HTTP body / MCP arg / webhook payload / queue event
  → handler entry (file:line)
  → validator (or absence of validator)
  → business logic
  → sink (file:line)
```

If the chain breaks (input never reaches the sink), the finding is REFUTED — drop it. If the chain is complete, the trace strengthens the finding; include the chain in the PR comment.

If you cannot trace the chain in a reasonable time budget, mark the finding `info` and note "reachability not traced within budget" in the rationale.

Trace output: each surviving finding now carries a data-flow chain or an explicit "not traced" note.

### Phase 5 — Dedup

Cluster findings by **root cause**, not by location. Two findings that both flow from the same missing TypeBox schema are one finding with two affected sites. Two findings that report the same risk at the same line are obviously one.

For each cluster:

- Pick the most severe instance as the primary.
- List the other affected sites under the primary.
- Combine the remediation into one suggestion.

Dedup output: final findings list, ordered by severity (critical → info).

### Phase 6 — Report

Post **exactly one** PR comment with `gh pr comment <n> --repo <slug> --body <markdown>` containing, in this order:

1. Header: `## Security review (advisory)`
2. Composite score (the weighted sum across the rubric criteria, 0.0–1.0).
3. Overall verdict — one sentence.
4. Per-criterion pass/fail table with a one-line rationale per criterion.
5. Findings list (one section per finding):
   - `### <severity>: <one-line title>`
   - File:line, criterion, data-flow chain (or "not traced"), remediation.
6. Footer note: "Advisory only — does not block the PR. Complements Semgrep static analysis."

Then produce the structured task output the runtime expects (`PrReviewOutput`): `scores` array per rubric criterion (boolean 0/1), `composite`, `verdict`.

## Anti-patterns to avoid

- Reporting a finding without a data-flow chain or an explicit "not traced" note. Untracked findings are noise.
- Reporting Semgrep-equivalent findings without citing the Semgrep rule. Duplication wastes reviewer attention.
- Scoring `safe_failure_modes` based on absence of try/catch — fail-closed is about behavior, not syntax.
- Flagging "no test for new code" as a security finding. That belongs to complexity review.
- Posting more than one PR comment. The Report phase is a single comment.
- Emitting findings about untouched code. Score the diff, not the codebase.
- Letting any finding through Phase 4 without a reachability call. If reachability is uncertain, say so explicitly.

## Output discipline

The PR comment is human-facing; the `PrReviewOutput` structured output is machine-facing. They must agree:

- If you scored `injection_safety: 0`, the comment must contain at least one finding citing that criterion.
- If you scored a criterion `1`, the comment must say so in the per-criterion table.
- The composite must equal the weighted sum of the boolean scores using the rubric's declared weights. The validator will reject a mismatched composite.
