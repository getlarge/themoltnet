/**
 * PR-complexity rubric (v1) — drives an `assess_brief` judgment over a
 * pull request, scoring how risky / hard-to-review it is.
 *
 * The rubric is the variation point that lets `assess_brief` (a generic
 * judgment task type) cover PR review without a domain-specific task
 * type or executor. Keep the criteria few, weighted, and judge-friendly:
 *
 * - Each criterion's `description` is the prompt the judge will reason
 *   over. Be explicit about what scoring 1.0 vs 0.0 looks like so the
 *   model has anchors.
 * - Weights MUST sum to 1.0; the runtime rejects mismatches client-side.
 * - All criteria are `llm_judged` continuous 0..1 — there's no
 *   deterministic check that captures "is this PR easy to review."
 *
 * Future variants (`pr-complexity-v2`, `pr-security-v1`, `pr-a11y-v1`)
 * sit alongside this file. The imposer picks one and inlines its
 * criteria into the task input. This is the canonical "add a new
 * domain by adding a rubric, not a task type" pattern.
 */
import type { AssessBriefCriterion } from '../task-types/assess-brief.js';

export const PR_COMPLEXITY_V1_ID = 'pr-complexity-v1' as const;

export const PR_COMPLEXITY_V1_PREAMBLE = `
You are reviewing a GitHub pull request for **complexity** — how hard
this change is to review safely, NOT whether it's correct or whether
the feature is worthwhile. The diff has already been opened by the
producer; your job is to score reviewability.

You may run \`gh pr diff <number>\`, \`gh pr view <number>\`, and read
files in the workspace. Don't run tests, don't push commits, don't
modify anything. The PR's GitHub URL is in the target metadata.

When in doubt about a criterion, score conservatively (lower) and
explain what made the call ambiguous. Reviewers will read your
rationale; "looks fine" is not useful, "the change touches three
unrelated subsystems and the test coverage on the auth path is
unchanged" is.
`.trim();

export const PR_COMPLEXITY_V1_CRITERIA: ReadonlyArray<AssessBriefCriterion> = [
  {
    id: 'cognitive_load',
    description:
      'How much does a reviewer have to hold in their head to assess this change? Score 1.0 for a single-purpose, well-named change with clear before/after semantics. Score 0.0 for a sprawling diff that interleaves refactor, behavior change, and dependency bumps. Look at: number of distinct concepts touched, naming clarity, whether the PR description explains the why.',
    weight: 0.25,
    scoring: 'llm_judged',
  },
  {
    id: 'blast_radius',
    description:
      'How far can a regression from this change propagate? Score 1.0 if the change is isolated to a single module with no public API surface change. Score 0.0 if it modifies a public contract, schema, migration, auth path, or shared utility consumed across the codebase. Look at: package boundaries crossed, exported symbols changed, schema/migration files touched, configuration defaults altered.',
    weight: 0.25,
    scoring: 'llm_judged',
  },
  {
    id: 'test_coverage_delta',
    description:
      'Does the change add or update tests proportional to the risk it introduces? Score 1.0 when new behavior is covered by tests at the right level (unit/integration/e2e) AND existing tests still pass without modification. Score 0.0 when behavior changes are landed without tests, or when tests are deleted/disabled to make the change pass. Look at: ratio of test changes to source changes, whether new branches have at least one test, whether any test file lost coverage.',
    weight: 0.2,
    scoring: 'llm_judged',
  },
  {
    id: 'security_surface',
    description:
      'Does the change touch authentication, authorization, cryptography, secrets, or external network egress? Score 1.0 when the PR is purely internal refactor or pure UI/copy with no security implications. Score 0.0 when it modifies an auth path, changes a permission check, introduces a new external dependency that processes user input, or alters a crypto primitive. Score 0.5 when it touches adjacent code (e.g. logs near a token) without changing the security path itself. Always favor a lower score when in doubt.',
    weight: 0.2,
    scoring: 'llm_judged',
  },
  {
    id: 'reviewer_orientation',
    description:
      'Does the PR description, commit messages, and diary entries (if any) tell a reviewer what changed and why? Score 1.0 for a PR with a clear summary, motivated by a linked issue, and individual commit messages that narrate the change. Score 0.0 for an empty description, single bulk commit titled "wip" or "fix", and no rationale anywhere. Look at: PR title quality, body length and substance, commit message hygiene, presence of "why" rather than just "what."',
    weight: 0.1,
    scoring: 'llm_judged',
  },
];

/**
 * Convenience export — the imposer inlines this directly into
 * `AssessBriefInput.criteria` and the rubric preamble into
 * `rubricPreamble`. The runtime will pin everything via the task's
 * `inputCid`.
 */
export const PR_COMPLEXITY_V1 = {
  rubricId: PR_COMPLEXITY_V1_ID,
  version: 'v1',
  preamble: PR_COMPLEXITY_V1_PREAMBLE,
  criteria: PR_COMPLEXITY_V1_CRITERIA,
  scope: 'pull_request',
} as const;
