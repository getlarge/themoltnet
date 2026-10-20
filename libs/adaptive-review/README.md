# Adaptive review policy

Adaptive review reads `.github/adaptive-review.json` from the pull request's
**base commit**. A repository opts in by adding a version 1 JSON file on its
base branch. A PR adding or changing the policy is reviewed under the old base
policy; the new policy takes effect after merge. A missing file skips adaptive
review. An invalid file fails the review configuration step.

```json
{
  "checks": [],
  "lanes": ["tests"],
  "rules": [],
  "version": 1
}
```

`lanes` is a nonempty, unique subset of `docs`, `tests`, `conventions`,
`security`, `blast-radius`, and `complexity`. The two score questions remain
part of each classifier task. Only enabled lanes may start specialist tasks.

Rules provide `id`, `description`, `kind` (`mechanical` or `semantic`), `paths`,
and `source`. Descriptions are the governing policy text. Sources are citations
for humans, not instructions for reviewers to load from the PR head. A check
points at a rule with `ruleId`; its hit is a candidate for a focused review,
not a finding. Checks have `id`, `kind`, `paths`, optional `excludePaths`, and
`detail`. The supported kinds are:

- `changed-path`: a matching path changed, including deletion or rename.
- `added-line`: a matching retained patch has an added line matching the
  RE2-compatible `pattern`. Missing or summarized content is marked unknown.
- `missing-companion`: a matching source changed without a matching added or
  modified file in `companionPaths`. A deleted companion does not count.

Globs are root-relative, case-sensitive POSIX paths. A `*` matches within one
path segment and `**` matches zero or more segments. Dotfiles are matched by
wildcards. Negation, braces, character classes, parent traversal, and absolute
paths are not supported; use `excludePaths` for exclusions. Rule and check
lists are bounded and validated before routing.

Optional `docs.config` and `complexity.rubric` are root-relative paths to
base-commit JSON files for their enabled lanes. They do not select runtime
code, commands, credentials, providers, or worker profiles. The caller workflow
owns those capabilities.

The reusable workflow lives in the MoltNet runtime repository. A caller
supplies its review profiles, model provider, and protected paths. Its own PR
base supplies this policy and any referenced docs or complexity JSON. The
reviewer fetches the pinned head as Git data and reads `git diff base...head`;
it never runs code from the head. The full name/status manifest includes
deletions and both sides of renames even when patch evidence is summarized.
The policy and reference digests, PR revisions, and runtime SHA are checked
again before a comment is published.

The classifier is selected by the caller's profile. MoltNet uses Ollama Cloud
`clef:27b` through its issue-classifier-v2 profile; other repositories can select
another System One classifier without changing this library. Classifier
scores determine which enabled lanes receive deeper review. A classifier
failure routes every enabled lane for review.

The caller supplies `task-budgets` as JSON. A `focused` entry is required when
tests, conventions, or blast-radius is enabled; a `security` entry is required
when security is enabled. Each entry specifies `runningTimeoutSec`,
`dispatchTimeoutSec`, and `expiresInSec`, and expiry must cover dispatch plus
running time. Size these limits for the selected profiles and the reusable
workflow's review and worker deadlines. MoltNet's caller uses 12 minutes for
its 40-turn focused profile and 15 minutes per staged security task; the
library contains no model-specific timeout. The shorter docs and complexity
stages keep their own budgets.

For a caller repository, add a `pull_request` workflow that invokes
`getlarge/themoltnet/.github/workflows/adaptive-review-reusable.yml` at a
trusted commit or release tag, passes `secrets: inherit`, and names an
environment containing the MoltNet agent and provider keys. Pass at least a
classifier profile, `task-budgets`, a nonempty `providers` definition, and
profiles for each lane enabled in `.github/adaptive-review.json`.
`protected-paths` should
include the caller workflow and any trusted runtime configuration it owns.
For private repositories, bind workers to a private diary; the review report
does not require a public diary.
