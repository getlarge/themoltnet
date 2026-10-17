# Adaptive PR review experiment

This workflow starts with bounded TypeSafe Jev classification of a pinned PR diff.
It asks six independent yes/no questions: docs impact, test adequacy, repository
conventions, security surface, blast radius, and conceptual complexity. Two Score
questions describe code complexity and expected review effort on a 0–3 scale.
The scores are shown separately from findings and do not determine whether a
review passes.

The reviewer reads changes through `git diff <base>...<head>` after GitHub Actions
fetches the exact head commit. `buildEvidence` supplies changed paths, a diff stat,
and patch text. Large patches are split into 24 KB Jev packets without dropping
source bytes. Lockfile payloads and files marked generated at the base revision
are summarized or omitted and recorded as evidence gaps. Classifier output only
routes work; the deeper review tasks inspect source and report findings.

## Routing

The initial mode is `shadow`: all six deep lanes run, while Jev's would-be
routes are recorded. Set repository variable `MOLTNET_ADAPTIVE_REVIEW_MODE` to
`active` after reviewing shadow results. Active mode runs a lane when its maximum
packet probability is at least 0.2, or 0.1 for security. It also runs the
conventions lane when a deterministic check sees a possible violation. Classifier
failure, missing answers, summarized patches, or generated paths route all lanes
for investigation. A lane below threshold is labeled **screened, not verified**.

The conventions catalog lives in `src/conventions.ts` on the trusted base
revision. Rules name their source, applicable paths, and exceptions. It covers
Nx task inference and cache outputs, TypeScript project references and package
exports, lint boundaries, test structure, database and API patterns, UI and docs
accessibility, and review workflow trust. Deterministic checks flag missing
schema migrations, TypeScript path aliases, dynamic imports in tests, direct
environment access, and Secretlint ignore changes. Existing lint, typecheck,
formatting, and CI gates remain authoritative for mechanical verdicts. The
deeper reviewer checks contextual rules and exceptions before reporting a
finding.

The docs and complexity lanes reuse the established review workflows. Security
reuses the two-stage hunt and disproof contract and its skill. Tests, conventions,
and blast radius use focused structured reviews. Detailed security results stay
in team-scoped tasks; the public PR comment gives only a generic follow-up
status. Existing independent review workflows continue to run.

## Operation and evaluation

`.github/workflows/adaptive-review.yml` runs on ready same-repository PRs. It
checks out trusted base code, fetches the head as inert Git data, creates task
workers, and upserts one LeGreffier App comment with a report artifact. Drafts,
forks, Dependabot PRs, and PRs changing this workflow or runtime are skipped.
The workflow uses the existing `legreffier` environment, agent credentials,
TypeSafe key, and five runtime profiles. The report is advisory; it does not
replace CI or required reviews.

Before enabling active mode, compare shadow routes with completed deep-lane
results on representative PRs. In particular, count how often a lane with a
concrete finding would have been screened, inspect docs and security misses,
and adjust thresholds or questions in code. Record packet and evidence gaps
separately from model misses. The current thresholds are an experiment, not a
measured guarantee.
