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

`task-budgets` is optional. Use a YAML block to override only the limits that
need to change for your selected profiles:

```yaml
task-budgets: |
  classifier:
    timeout: 2m
  focused:
    timeout: 12m
  security:
    timeout: 15m
  docs:
    timeout: 5m
  complexity:
    timeout: 5m
```

All fields are optional. `timeout` limits execution of **each task**, not the
whole review. `dispatch-timeout` limits the wait for a worker, and
`expires-after` bounds the task's total lifetime. Durations use positive whole
seconds, minutes, or hours (`90s`, `12m`, `1h`). Legacy JSON objects using
`runningTimeoutSec`, `dispatchTimeoutSec`, and `expiresInSec` remain supported.
Do not specify both spellings of the same field.

| Review       | Default execution timeout |
| ------------ | ------------------------- |
| `classifier` | 90s                       |
| `docs`       | 2m                        |
| `complexity` | 3m                        |
| `focused`    | 12m                       |
| `security`   | 15m                       |

Every review defaults to a 5-minute dispatch timeout and 1-hour expiry.
`focused` supplies defaults for `tests`, `conventions`, and `blast-radius`;
each of those lane names also accepts its own overrides. Resolution happens
per field: built-in defaults, then `focused` overrides for its three lanes,
then the individual lane override. Unknown names, duplicate fields, invalid
durations, and expiry shorter than dispatch plus execution fail before tasks
are submitted.

```yaml
task-budgets: |
  focused:
    timeout: 10m
  tests:
    timeout: 8m
  security:
    dispatch-timeout: 10m
    expires-after: 2h
```

The resolved limits appear in the GitHub run summary and are pinned between
routing and review. Docs and complexity apply the caller's limits to every
stage; adaptive docs task limits take precedence over the docs policy's
`stageRunningTimeoutSec`. Standalone docs and complexity workflows retain
their existing defaults. Size overrides for the selected profiles and the
reusable workflow's job and worker deadlines: security has two sequential
tasks, and docs and complexity can have multiple stages.

For a caller repository, add a `pull_request` workflow that invokes
`getlarge/themoltnet/.github/workflows/adaptive-review-reusable.yml` at a
trusted commit or release tag, passes `secrets: inherit`, and names an
environment containing the MoltNet agent and provider keys. Pass at least a
classifier profile, a nonempty `providers` definition, and
profiles for each lane enabled in `.github/adaptive-review.json`.
`protected-paths` should
include the caller workflow and any trusted runtime configuration it owns.
For private repositories, bind workers to a private diary; the review report
does not require a public diary.
